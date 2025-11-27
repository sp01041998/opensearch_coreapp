

import { getRoleSpecificCredentials } from '../services/credentials_service';
import { readFile } from 'fs/promises';
import fs from 'fs';
import * as crypto from 'crypto';

interface SignAWS4SignatureParams {
    endpoint: string;
    method: string;
    secretKey?: string;
    accessKey?: string;
    payload?: string;
    querystring?: string;
    sessionToken?: string; // Optional session token
}

interface AWS4Headers {
    'x-amz-date': string;
    Authorization: string;
    'x-amz-security-token'?: string;
}

interface TemporaryCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: Date;
}

const ES_HOST = process.env.ES_HOST;
const REGION = process.env.REGION;
const credentialsPath = 'aws_credentials.json';

let awsCredentials: any;


async function loadAWSCredentials() {
    try {
        const data = await readFile(credentialsPath, 'utf8');
        awsCredentials = JSON.parse(data);
        const credObj: TemporaryCredentials = {
            accessKeyId: awsCredentials?.accessKey,
            secretAccessKey: awsCredentials?.secretKey,
            sessionToken: awsCredentials?.sessionToken,
            expiration: awsCredentials?.expiration,
        };
        // AWS.config.credentials = credObj;
        console.log('AWS Credentials Updated: cluster_client');
        return credObj;
    } catch (err) {
        console.error('Error reading AWS credentials:', err);
    }
}

(async () => {
    console.log('Loading AWS Credentials');
    await loadAWSCredentials();
})();

// Watch for file changes and reload credentials
fs.watchFile(credentialsPath, { interval: 5000 }, async () => {
    console.log('Detected AWS aws_credentials update. Reloading cluster_client...');
    await loadAWSCredentials();
});

async function getAWSCredentials() {
    return awsCredentials;
}

async function signAWS4Signature({
    endpoint,
    method,
    secretKey = '',
    accessKey = '',
    sessionToken = '',
    payload = '',
    querystring = '',
}: SignAWS4SignatureParams): Promise<AWS4Headers> {
    const region = REGION;
    const service = 'es';
    const host = ES_HOST;

    if (!accessKey || !secretKey) {
        const creds: any = await getAWSCredentials();
        accessKey = creds.accessKey;
        secretKey = creds.secretKey;
        sessionToken = creds.sessionToken;
    }

    const cleaned = endpoint
        .split('/')
        .filter((segment) => segment !== 'undefined' && segment !== '')
        .join('/');
    endpoint = '/' + cleaned;

    const endpointHasQuertString = endpoint?.includes('?');
    if (endpointHasQuertString) {
        querystring = endpoint.split('?')[endpoint.split('?').length - 1];
        endpoint = endpoint.split('?')[0];
    }
    function sign(key: string | Buffer, msg: string): Buffer {
        return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
    }

    function getSignatureKey(
        key: string,
        dateStamp: string,
        regionName: string,
        serviceName: string
    ): Buffer {
        const kDate = sign(`AWS4${key}`, dateStamp);
        const kRegion = sign(kDate, regionName);
        const kService = sign(kRegion, serviceName);
        return sign(kService, 'aws4_request');
    }

    function sha256Hex(data: string): string {
        return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
    }

    // Generate date strings
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    let canonicalURI = encodeURI(endpoint).replace(/%3A/g, ':');
    canonicalURI = encodeURI(endpoint).replace(/\*/g, '%2A');

    if (
        canonicalURI.startsWith('/.kibana/_doc/search') ||
        canonicalURI.startsWith('/.kibana/_doc/index-pattern')
    ) {
        canonicalURI = canonicalURI.replace(/:/g, '%253A');
    }

    let canonicalQueryString = '';

    if (canonicalURI === '/.kibana/_search') {
        canonicalQueryString = querystring
            ? new URLSearchParams(querystring).toString().replace(/\*/g, '%2A')
            : '';
    } else {
        if (typeof querystring === 'string') {
            canonicalQueryString = new URLSearchParams(querystring).toString().replace(/\*/g, '%2A');
        } else {
            if (
                endpoint === '/_plugins/_alerting/monitors/alerts' ||
                endpoint === '/_plugins/_alerting/findings/_search' ||
                endpoint.startsWith('/_plugins/_alerting/monitors') ||
                endpoint.startsWith('/_plugins/_alerting/workflows')
            ) {
                const filteredParams = Object.entries(querystring).filter(
                    ([key, value]) => value !== undefined && value !== null
                );

                canonicalQueryString = filteredParams
                    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
                    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                    .join('&')
                    .replace(/\*/g, '%2A');
            } else {
                const filteredParams = Object.entries(querystring)
                    .filter(([key, value]) => value !== undefined && value !== null)
                    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB)) // 🔹 Sort by key
                    .reduce((acc, [key, value]) => {
                        acc[key] = value;
                        return acc;
                    }, {});
                canonicalQueryString = new URLSearchParams(filteredParams).toString().replace(/\*/g, '%2A');
            }
        }
    }
    console.log(`Requesting for ${canonicalURI} -------> ${canonicalQueryString}`);
    let canonicalHeaders = `host:${host}\n` + `x-amz-date:${amzDate}\n`;
    if (sessionToken) {
        canonicalHeaders += `x-amz-security-token:${sessionToken}\n`;
    }
    const signedHeaders = sessionToken ? 'host;x-amz-date;x-amz-security-token' : 'host;x-amz-date';
    const payloadHash = sha256Hex(payload);

    const canonicalRequest = [
        method,
        canonicalURI,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    console.log('cannonical req', canonicalRequest);

    // Step 2: Create the String to Sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [algorithm, amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
        '\n'
    );

    // Step 3: Calculate the Signature
    const signingKey = getSignatureKey(secretKey, dateStamp, region, service);
    const signature = crypto
        .createHmac('sha256', signingKey)
        .update(stringToSign, 'utf8')
        .digest('hex');

    // Step 4: Build the Authorization Header
    const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Final headers for the request
    const headers: AWS4Headers = {
        'x-amz-date': amzDate,
        Authorization: authorizationHeader,
    };
    // Include the session token header if it is provided
    if (sessionToken) {
        headers['x-amz-security-token'] = sessionToken;
    }
    return headers;
}





async function clusterClientWrapper(endpoint: string, clientParams: any, options: any, api) {
    if (
        endpoint !== 'cat.indices' &&
        endpoint !== 'cat.aliases' &&
        !options?.tempCred &&
        options?.tenantId
    ) {
        const tempCred = await getRoleSpecificCredentials(
            `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/${options.tenantId}`,
            `tenantId-${options.tenantId}`
        );

        options.tempCred = tempCred;
    }
    const apiEndpoint = api.spec?.urls ? api.spec.urls[0]?.fmt : api.spec.url?.fmt;
    
    if (endpoint.startsWith('alerting')) {
        const {
            headers,
            body,
            detectorId = '',
            ruleId,
            category,
            id,
            reportDefinitionId,
            reportInstanceId,
            monitorId,
            workflowId,
            ...rest
        } = clientParams;
        clientParams.headers = await signAWS4Signature({
            endpoint:
                apiEndpoint
                    .replace('<%=resourceName%>', clientParams.resourceName)
                    .replace('<%=id%>', clientParams.id)
                    .replace('<%=index%>', clientParams.index)
                    .replace('<%=prePackaged%>', true)
                    .replace('<%=indexName%>', clientParams.indexName)
                    .replace('<%=reportDefinitionId%>', clientParams?.reportDefinitionId)
                    .replace('<%=reportInstanceId%>', clientParams?.reportInstanceId)
                    .replace('<%=monitorId%>', monitorId)
                    .replace('<%=workflowId%>', workflowId)
                    .replace('?dryrun=<%=dryrun%>', '')
                    .replace('?refresh=wait_for', '')
                    .replace('<%=detectorId%>', detectorId)
                    .replace('<%=ruleId%>', ruleId)
                    .replace('<%=category%>', category)
                    .replace('<%=ruleTopic%>', clientParams.ruleTopic) || '/_' + endpoint.replace('.', '/'),

            method: api.spec.method,
            secretKey: options?.tempCred?.secretAccessKey,
            accessKey: options?.tempCred?.accessKeyId,
            sessionToken: options?.tempCred?.sessionToken,
            payload: typeof body === 'string' ? body : JSON.stringify(body),
            ...(endpoint === 'alerting.createMonitor' && { querystring: { refresh: 'wait_for' } }),
            ...(endpoint === 'alerting.getAlerts' && { querystring: { ...rest, monitorId } }),
            ...(endpoint !== 'alerting.createMonitor' &&
                endpoint !== 'alerting.getAlerts' && { querystring: clientParams.query || rest }),
        });
    } else {
        const {
            headers,
            body,
            detectorId = '',
            ruleId,
            category,
            index,
            id,
            reportDefinitionId,
            reportInstanceId,
            logTypeId,
            ...rest
        } = clientParams;
        if (endpoint === 'securityAnalytics.acknowledgeAlerts') delete rest.detector_id;
        clientParams.headers = await signAWS4Signature({
            endpoint:
                apiEndpoint
                    .replace('<%=resourceName%>', clientParams.resourceName)
                    .replace('<%=id%>', clientParams.id)
                    .replace('<%=index%>', clientParams.index)
                    .replace('<%=prePackaged%>', true)
                    .replace('<%=indexName%>', clientParams.indexName)
                    .replace('<%=reportDefinitionId%>', clientParams?.reportDefinitionId)
                    .replace('<%=reportInstanceId%>', clientParams?.reportInstanceId)
                    .replace('<%=<%=dryrun%>%>', clientParams?.dryrun)
                    .replace('<%=detector_id%>', clientParams.detector_id)
                    .replace('?start_timestamp=<%=start_timestamp%>', '')
                    .replace('&end_timestamp=<%=end_timestamp%>', '')
                    .replace('<%=detectorId%>', detectorId)
                    .replace('<%=logTypeId%>', logTypeId)
                    .replace('<%=ruleId%>', ruleId)
                    .replace('<%=category%>', category)
                    .replace('/<%=name%>', '')
                    .replace('<%=ruleTopic%>', clientParams.ruleTopic) || '/_' + endpoint.replace('.', '/'),

            method: api.spec.method,
            secretKey: options?.tempCred?.secretAccessKey,
            accessKey: options?.tempCred?.accessKeyId,
            sessionToken: options?.tempCred?.sessionToken,
            payload: typeof body === 'string' ? body : JSON.stringify(body),
            querystring: clientParams.query || rest,
        });
    }


}

export { clusterClientWrapper };