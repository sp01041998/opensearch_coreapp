import dotenv from 'dotenv';
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  GetUserCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';

dotenv.config();

const REGION = process.env.REGION;

export interface CurrentUser {
  email: string;
  role?: string;
}

const cognito = new CognitoIdentityProviderClient({ region: REGION });

export async function validateAccessToken(
  accessToken: string | undefined,
  currentUser: CurrentUser
): Promise<boolean> {
  if (!accessToken) return false;

  try {
    const res: GetUserCommandOutput = await cognito.send(
      new GetUserCommand({ AccessToken: accessToken })
    );

    const emailAttr = res.UserAttributes?.find((a) => a.Name === 'email');
    if (emailAttr?.Value) {
      currentUser.email = emailAttr.Value.trim().toLowerCase();
    }

    if (!currentUser.email && res.Username) {
      currentUser.email = res.Username;
    }

    return !!res;
  } catch (error) {
    // you can hook your logger here instead of console
    console.error('Invalid access token', error);
    return false;
  }
}
