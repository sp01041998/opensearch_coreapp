/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import https from 'https';
import aws4 from 'aws4';
import { isEmpty } from 'lodash';
import { readFile } from 'fs/promises';
import fs from 'fs';
// import AWS from 'aws-sdk';
// import dotenv from 'dotenv';
// dotenv.config();

const credentialsPath = 'aws_credentials.json';

const HTTP_BAD_REQUEST_MESSAGE = {
  message: 'Bad Request',
  statusCode: 400,
};

interface CallESApiParams {
  data?: any;
  path: string;
  method: string;
  retry?: number;
  referer?: string | null;
  headers?: Record<string, string>;

  host?: string;
}
let awsCredentials: any;
async function loadAWSCredentials() {
  try {
    const data = await readFile(credentialsPath, 'utf8');
    awsCredentials = JSON.parse(data);
    const credObj: any = {
      accessKeyId: awsCredentials?.accessKey,
      secretAccessKey: awsCredentials?.secretKey,
      sessionToken: awsCredentials?.sessionToken,
      expiration: awsCredentials?.expiration,
    };
    // AWS.config.credentials = credObj;
    awsCredentials = credObj;
    console.log('AWS Credentials Updated: esApi.ts');
  } catch (err) {
    console.error('Error reading AWS credentials:', err);
  }
}
(async () => {
  console.log('Loading AWS Credentials esApi.ts...');
  await loadAWSCredentials();
})();
// Watch for file changes and reload credentials
fs.watchFile(credentialsPath, { interval: 5000 }, async () => {
  // es-lint-disable-next-line no-console
  console.log('Detected AWS aws_credentials update. Reloading cluster_client...');
  await loadAWSCredentials();
});
async function getAWSCredentials() {
  return awsCredentials;
}
async function callESApi({
  data = {},
  path,
  method,
  retry = 0,
  referer = null,
  headers = {},
  host = "search-dashboard-test-v1-aera734vki7qwjh7frwvieda2i.us-west-2.es.amazonaws.com",
}: CallESApiParams): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      const postData = JSON.stringify(data);
      const options: any = {
        host,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 1000000,
        maxRedirects: 20,
        service: 'es',
        region: 'us-west-2',
      };

      if (!isEmpty(data)) options.body = postData;
      if (!isEmpty(headers)) options.headers = { ...options.headers, ...headers };
      if (referer) options.headers.referer = referer;
      const creds = await getAWSCredentials();
      aws4.sign(options, {
        secretAccessKey: creds.secretAccessKey,
        accessKeyId: creds.accessKeyId,
        sessionToken: creds.sessionToken,
      });

      const req = https.request(options, function (res) {
        res.setEncoding('utf-8');

        let chunks = '';
        const statusCode = res.statusCode;
        const statusMessage = res.statusMessage;

        res.on('data', function (chunk) {
          chunks += chunk;
        });

        res.on('end', function () {
          console.log('Call>>>>>>>>>>', retry);
          if (
            chunks.includes('Call to Authorization engine failed') ||
            chunks.includes('403 Request throttled due to too many requests') ||
            chunks.includes('{"Message":null}')
          ) {
            retry = retry + 1;
            if (retry > 3) {
              try {
                retry = 0;
                const parseData =
                  chunks?.length > 0
                    ? chunks?.includes('<html>')
                      ? HTTP_BAD_REQUEST_MESSAGE
                      : JSON.parse(chunks)
                    : chunks;
                const resolveData: Record<string, any> = {};
                resolveData.data = parseData;
                resolveData.statusCode = statusCode;
                resolveData.statusMessage = statusMessage;
                resolve(resolveData);
              } catch (error) {
                console.error(`Error occurred while parsing the response: ${error} `);
              }
            } else {
              const delay = (t) => new Promise((resolve) => setTimeout(resolve, t));
              delay(5000).then(() => resolve(callESApi({ data, path, method, retry })));
            }
          } else {
            try {
              retry = 0;
              const parseData =
                chunks?.length > 0
                  ? chunks?.includes('<html>')
                    ? HTTP_BAD_REQUEST_MESSAGE
                    : JSON.parse(chunks)
                  : chunks;
              const resolveData: Record<string, any> = {};
              resolveData.data = parseData;
              resolveData.statusCode = statusCode;
              resolveData.statusMessage = statusMessage;
              resolve(resolveData);
            } catch (error) {
              console.error(`Error occurred while parsing the response: ${error} `);
            }
          }
        });

        res.on('error', function (error: any) {
          console.log('On Res Error');
          console.log(error);
          if (error?.statusCode >= 500) {
            retry = retry + 1;
            if (retry > 3) {
              console.log('Max retries reached - >', error);
              reject(error);
            } else {
              const delay = (t: number) => new Promise((resolve) => setTimeout(resolve, t));
              delay(5000 * retry).then(() => resolve(callESApi({ data, path, method, retry })));
            }
          } else {
            console.log('Error - >', error);
            reject(error);
          }
        });
      });

      req.on('error', (e: any) => {
        console.log('On Req Error');
        console.log(e);
        if (e.statusCode >= 500) {
          retry = retry + 1;
          if (retry > 3) {
            console.log('Max retries reached - >', e);
            reject(e);
          } else {
            const delay = (t: number) => new Promise((resolve) => setTimeout(resolve, t));
            delay(5000 * retry).then(() => resolve(callESApi({ data, path, method, retry })));
          }
        } else {
          console.log('Error - >', e);
          reject(e);
        }
      });

      if (!isEmpty(data)) req.write(postData);
      req.end();
    } catch (err) {
      console.log('Error Occurred -> ', err);
      reject(err);
    }
  });
}
export { callESApi };
