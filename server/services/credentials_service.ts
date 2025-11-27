/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
// import AWS from 'aws-sdk';
import { STSClient, AssumeRoleCommand, AssumeRoleCommandOutput } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, Provider } from '@aws-sdk/types';


import { callESApi } from './opensearch_api_service';
import * as fsPromise from 'fs/promises';
import * as fs from 'fs';

interface TemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

interface IndexPermission {
  index_patterns: string[];
  dls: string;
}

interface FetchRoleParams {
  tenantId: string;
}

interface UpdateDLSParams {
  id: string;
  type: 'dashboard' | 'search' | 'visualization';
  tenantId: string;
}

interface IndexPermission {
  index_patterns: string[];
  dls: string;
}

interface RoleData {
  [tenantId: string]: {
    index_permissions: IndexPermission[];
    reserved?: boolean;
    hidden?: boolean;
    static?: boolean;
    [key: string]: any;
  };
}

interface FetchRoleParams {
  tenantId: string;
}

interface UpdateDLSParams {
  id: string;
  type: 'dashboard' | 'search' | 'visualization';
  tenantId: string;
}

const HTTP_OK = 200;
const HTTP_METHODS = {
  GET: 'GET',
  PUT: 'PUT',
};

const credentialsPath = 'aws_credentials.json';
let overrideCreds: AwsCredentialIdentity | null = null; // hot-swapped creds

const baseProfileProvider = fromIni({
  profile: process.env.AWS_PROFILE || undefined, // falls back to default chain if not set
});

/** Clients will call this on every request; uses hot creds if present, else profile/defaults. */
const credentialsProvider: Provider<AwsCredentialIdentity> = async () => {
  if (overrideCreds) return overrideCreds;
  return baseProfileProvider();
};

function setCredentials(creds: {
  accessKey?: string;
  secretKey?: string;
  sessionToken?: string;
  expiration?: string | number | Date;
}) {
  if (!creds.accessKey || !creds.secretKey) {
    // If file is temporarily empty/invalid, drop override to fall back to base provider
    overrideCreds = null;
    return;
  }
  overrideCreds = {
    accessKeyId: creds.accessKey,
    secretAccessKey: creds.secretKey,
    sessionToken: creds.sessionToken,
  };
  // Note: v3 credential identity does not require `expiration`; refresh logic is external.
  console.log('AWS credentials updated (v3 override)');
}

// Initial load + watch for changes (hot reload)
async function loadAWSCredentialsFromFile() {
  try {
    const data = await fsPromise.readFile(credentialsPath, 'utf8');
    const awsCredentials = JSON.parse(data) as {
      accessKey?: string;
      secretKey?: string;
      sessionToken?: string;
      expiration?: string | number | Date;
    };
    setCredentials(awsCredentials);
    console.log('AWS Credentials Updated: from utils (v3)...');
  } catch (err) {
    // If file missing or invalid, keep using profile/default chain
    console.error('Error reading AWS credentials (v3):', err);
  }
}

(async () => {
  console.log('Loading AWS Credentials for utils (v3)...');
  await loadAWSCredentialsFromFile();
})();

fs.watchFile(credentialsPath, { interval: 5000 }, async () => {
  console.log('Detected aws_credentials update. Reloading from utils (v3)...');
  await loadAWSCredentialsFromFile();
});

const getRoleSpecificCredentials = async (
  roleArn: string,
  sessionName: string
): Promise<TemporaryCredentials> => {
  // const sts = new AWS.STS();
  const sts = new STSClient({ region: process.env.AWS_REGION || 'us-west-2', credentials : credentialsProvider});

  const data: AssumeRoleCommandOutput = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName,
    })
  );

  if (!data.Credentials) {
    throw new Error('Failed to retrieve credentials from STS.');
  }

  // Return cleanly typed credentials
  return {
    accessKeyId: data.Credentials.AccessKeyId!,
    secretAccessKey: data.Credentials.SecretAccessKey!,
    sessionToken: data.Credentials.SessionToken!,
  };
};

const fetchRoleDetailOfTenant = async ({ tenantId }: FetchRoleParams): Promise<RoleData | null> => {
  const roleData = await callESApi({
    data: {},
    path: `/_plugins/_security/api/roles/${tenantId}`,
    method: HTTP_METHODS.GET,
  });

  console.log(
    `Fetched role data from OpenSearch for tenant ${tenantId} - ${JSON.stringify(roleData)}`
  );

  return roleData?.statusCode === HTTP_OK ? roleData.data : null;
};

const updateDLS = async ({ id, type, tenantId }: UpdateDLSParams): Promise<void> => {
  const roleData = await fetchRoleDetailOfTenant({ tenantId });
  if (!roleData) {
    throw new Error(`Could not get role data for tenant - ${tenantId}`);
  }

  const index = '.kibana*';
  const indexPermission = roleData[tenantId].index_permissions.find(
    (perm) => perm.index_patterns[0] === index
  );

  if (!indexPermission) {
    throw new Error(`No index permission found for index: ${index}`);
  }

  const kibanaDls = JSON.parse(indexPermission.dls);

  let visualizationDLSIdx: number | null = null;
  let dashboardDLSIdx: number | null = null;

  kibanaDls.bool.should.forEach((ele: any, i: number) => {
    if (ele?.bool?.must?.[0]?.term?.type === 'visualization') {
      visualizationDLSIdx = i;
    }
  });

  kibanaDls.bool.should.forEach((ele: any, i: number) => {
    if (ele?.bool?.must?.[0]?.term?.type === 'dashboard') {
      dashboardDLSIdx = i;
    }
  });

  if (!visualizationDLSIdx || !dashboardDLSIdx) {
    console.error(
      `Could not find DLS for dashboard or search in role data for tenant - ${tenantId} - ${JSON.stringify(
        roleData
      )}`
    );
    throw new Error(
      `Could not find DLS for dashboard or search in role data for tenant - ${tenantId}`
    );
  }

  const newId = id.startsWith(type) ? `${id}` : `${type}:${id}`;
  const targetIdx = type === 'visualization' ? visualizationDLSIdx : type === 'dashboard' ? dashboardDLSIdx : null;

  if (targetIdx === null) {
    console.error(`${type} not supported for DLS`);
    return;
  }

  const targetFilters =
    kibanaDls.bool.should[targetIdx].bool.filter[0].bool.should;

  let idsClause = targetFilters.find(
    (ele: any) => ele.bool?.should?.[0]?.ids?.values
  );

  if (idsClause) {
    // Append the new ID if it doesn’t already exist
    const idsArray = idsClause.bool.should[0].ids.values;
    if (!idsArray.includes(newId)) {
      idsArray.push(newId);
    }
  } else {
    // Create a new clause if one doesn’t exist
    const newClause = {
      bool: {
        should: [
          {
            ids: {
              values: [newId],
            },
          },
        ],
        minimum_should_match: 1,
      },
    };
    targetFilters.push(newClause);
  }


  // const newDoc = {
  //   match: {
  //     _id: id.startsWith(type) ? `${id}` : `${type}:${id}`,
  //   },
  // };



  // if (type === 'visualization') {
  //   kibanaDls.bool.should[visualizationDLSIdx].bool.filter[0].bool.should.push(newDoc);
  // } else if (type === 'dashboard') {
  //   kibanaDls.bool.should[dashboardDLSIdx].bool.filter[0].bool.should.push(newDoc);
  // } else {
  //   console.error(`${type} not supported for DLS`);
  //   return;
  // }

  indexPermission.dls = JSON.stringify(kibanaDls);

  // Delete reserved OpenSearch role fields if present
  delete roleData[tenantId].reserved;
  delete roleData[tenantId].hidden;
  delete roleData[tenantId].static;

  const updatedRole = await callESApi({
    data: roleData[tenantId],
    path: `/_plugins/_security/api/roles/${tenantId}`,
    method: HTTP_METHODS.PUT,
  });

  console.log(`Updated role data for tenant ${tenantId} - ${JSON.stringify(updatedRole)}`);
};

export { getRoleSpecificCredentials, credentialsProvider, updateDLS, fetchRoleDetailOfTenant };
