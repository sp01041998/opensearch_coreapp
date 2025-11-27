import { SavedObjectsClientWrapperFactory } from 'opensearch-dashboards/server';
import { SavedObjectsAuthService } from '../services/so_auth_service';
import { parseCookies } from '../utils/cookie_parser';
import { updateDLS, fetchRoleDetailOfTenant } from '../services/credentials_service';   // ← create this wrapper

const soAuth = new SavedObjectsAuthService();


// function parseCookies(cookieHeader: any): Record<string, any> {
//     const cookies: Record<string, any> = {};
//     if (!cookieHeader) return cookies;

//     cookieHeader.split(';').forEach((cookie) => {
//         const [name, ...rest] = cookie.split('=');
//         cookies[name.trim()] = decodeURIComponent(rest.join('='));
//     });

//     return cookies;
// }

const extractIds = (filters) => {
    const ids = [];

    const traverse = (obj) => {
        if (Array.isArray(obj)) {
            obj.forEach(traverse);
        } else if (typeof obj === 'object' && obj !== null) {
            if (obj.match && obj.match._id) {
                ids.push(obj.match._id);
            }
            if (obj.ids && Array.isArray(obj.ids.values)) {
                ids.push(...obj.ids.values.map(id => id));
            }
            Object.values(obj).forEach(traverse);
        }
    };

    traverse(filters);
    return ids;
};

export const createCoreAppSOWrapper: SavedObjectsClientWrapperFactory = ({ client, request }) => {
    return new Proxy(client, {
        get(target, propKey) {

            //
            // WRAP GET()
            //
            if (propKey === 'get') {
                return async (type: string, id: string, options: any) => {
                    const parsedCookies = parseCookies(request?.headers?.cookie);
                    options = {
                        ...options,
                        idToken: request?.query.idToken || parsedCookies?.idToken,
                        accessToken: request?.query.accessToken || parsedCookies?.accessToken,
                        tenantId: request?.query.tenantId || parsedCookies?.tenantId,
                        email: request?.query.email || parsedCookies?.email,
                        unfilteredTenantId: request?.query.unfilteredTenantId || parsedCookies?.unfilteredTenantId,
                    };
                    console.log("SO Wrapper GET called with options:", options);
                    const { tempCred } = await soAuth.authenticateFromOptions(options);
                    return target.get(type, id, { ...options, tempCred });
                };
            }

            //
            // WRAP bulkGet()
            //
            if (propKey === 'bulkGet') {
                return async (objects: any[], options: any) => {
                    const parsedCookies = parseCookies(request?.headers?.cookie);
                    options = {
                        ...options,
                        idToken: request?.query.idToken || parsedCookies?.idToken,
                        accessToken: request?.query.accessToken || parsedCookies?.accessToken,
                        tenantId: request?.query.tenantId || parsedCookies?.tenantId,
                        email: request?.query.email || parsedCookies?.email,
                        unfilteredTenantId: request?.query.unfilteredTenantId || parsedCookies?.unfilteredTenantId,
                    };
                    const { tempCred } = await soAuth.authenticateFromOptions(options);
                    return target.bulkGet(objects, { ...options, tempCred });
                };
            }

            //
            // WRAP create()
            //
            if (propKey === 'create') {
                return async (type: string, attributes: any, options: any = {}) => {
                    const parsedCookies = parseCookies(request?.headers?.cookie);
                    const tenantId = request?.query?.tenantId || parsedCookies?.tenantId;
                    if (!tenantId) {
                        throw {
                            statusCode: 400,
                            error: 'Bad request',
                            message: 'Tenant ID is missing',
                        };
                    }
                    attributes = { ...attributes, tenantId }
                    const result = await target.create(type, attributes, { ...options });

                    // 4. Update DLS
                    const finalId = result.id;

                    try {
                        if (type === 'visualization' || type === 'dashboard') {
                            await updateDLS({
                                id: finalId,
                                type,
                                tenantId
                            });
                        }
                    } catch (e) {
                        console.error(`Failed to Update DLS for ${type} : ${finalId} - Tenant - ${tenantId}`, e);
                    }

                    return result
                };
            }

            if (propKey === "find") {
                return async (options: any) => {
                    const parsedCookies = parseCookies(request?.headers?.cookie);
                    const tenantId = request?.query.tenantId || parsedCookies?.tenantId
                    options = {
                        ...options,
                        idToken: request?.query.idToken || parsedCookies?.idToken,
                        accessToken: request?.query.accessToken || parsedCookies?.accessToken,
                        tenantId: request?.query.tenantId || parsedCookies?.tenantId,
                        email: request?.query.email || parsedCookies?.email,
                        unfilteredTenantId: request?.query.unfilteredTenantId || parsedCookies?.unfilteredTenantId,
                        perPage : 10000
                    };
                    const { tempCred } = await soAuth.authenticateFromOptions(options);
                    const result = await target.find({ ...options, tempCred });
                    // return result
                    console.log("SO Wrapper FIND called with options:", result?.saved_objects[0]);

                    const roleData = await fetchRoleDetailOfTenant({ tenantId: parsedCookies?.tenantId })
                    console.log(`Fetched role data from OpenSearch for tenant ${parsedCookies?.tenantId} - ${JSON.stringify(roleData)}`);
                    const allowedIndexPatterns = roleData?.[tenantId]?.index_permissions.map(obj => obj.index_patterns[0]) || [];

                    const type = request?.query?.type;
                    const typeList = (Array.isArray(type) ? type : type ? [type] : []);
                    let indexPatternObjs: any[] = [];
                    let searchObjs: any[] = [];
                    let visualizationObjs: any[] = [];

                    // Always keep original data
                    const originalObjects = result.saved_objects || [];

                    // -----------------------------
                    // 1. INDEX PATTERN FILTER
                    // -----------------------------
                    if (typeList.includes("index-pattern")) {
                        indexPatternObjs = originalObjects.filter((obj: any) => {
                            const startsWithTenant = obj.id.startsWith(tenantId);
                            const startsWithAllowedPattern = allowedIndexPatterns.some(pattern =>
                                obj.attributes.title.startsWith(pattern)
                            );
                            return startsWithTenant || startsWithAllowedPattern;
                        });
                    }

                    // -----------------------------
                    // 2. SEARCH FILTER
                    // -----------------------------
                    if (typeList.includes("search")) {
                        const index = ".kibana*";
                        const indexPermission = roleData[tenantId].index_permissions.find(
                            perm => perm.index_patterns[0] === index
                        );

                        const kibanaDls = JSON.parse(indexPermission.dls);
                        let searchIdx = kibanaDls.bool.should.findIndex(
                            ele => ele?.bool?.must?.[0]?.term?.type === "search"
                        );

                        const targetFilters =
                            kibanaDls.bool.should[searchIdx].bool.filter[0].bool.should;

                        const allowedIds = extractIds(targetFilters);

                        searchObjs = originalObjects.filter(obj => {
                            return allowedIds.includes(`${obj.type}:${obj.id}`);
                        });
                    }

                    // -----------------------------
                    // 3. VISUALIZATION FILTER
                    // -----------------------------
                    if (typeList.includes("visualization")) {
                        const index = ".kibana*";
                        const indexPermission = roleData[tenantId].index_permissions.find(
                            perm => perm.index_patterns[0] === index
                        );

                        const kibanaDls = JSON.parse(indexPermission.dls);
                        let vizIdx = kibanaDls.bool.should.findIndex(
                            ele => ele?.bool?.must?.[0]?.term?.type === "visualization"
                        );

                        const targetFilters =
                            kibanaDls.bool.should[vizIdx].bool.filter[0].bool.should;

                        const allowedIds = extractIds(targetFilters);

                        visualizationObjs = originalObjects.filter(obj =>{
                             return allowedIds.includes(`${obj.type}:${obj.id}`);
                    });

                     
                    }

                    // -----------------------------
                    // FINAL RESULT = UNION (not intersection)
                    // -----------------------------
                    let finalObjs = [
                        ...indexPatternObjs,
                        ...searchObjs,
                        ...visualizationObjs
                    ];

                    result.saved_objects = finalObjs;
                    result.total = finalObjs.length;

                    return result;

                }
            }

            // DEFAULT => passthrough
            return (target as any)[propKey];
        },
    });
};
