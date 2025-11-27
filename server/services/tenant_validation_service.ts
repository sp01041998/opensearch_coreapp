import { callESApi } from './opensearch_api_service';

// ---------- Types ----------
interface TenantAccountsParams {
  tenantId: string;
}

const getTenantAccountsByTenantId = async ({ tenantId }: TenantAccountsParams): Promise<any> => {
  try {
    const response = await callESApi({
      path: `/accounts/_search`,
      method: 'POST',
      data: {
        query: {
          term: {
            'TenantID.keyword': tenantId,
          },
        },
      },
      host: process.env.MAIN_OPENSEARCH_HOST_URL,
    });
    console.log('getTenantAccountsByTenantId response:', JSON.stringify(response?.data));
    return response?.data?.hits?.hits?.[0]?._source || {};
  } catch (error) {
    console.error('[OpenSearch] getTenantAccountsByTenantId failed:', error);
    throw error;
  }
};

export { getTenantAccountsByTenantId };
