import fs from 'fs';
import signale from 'signale';
import { FolderMapping } from './mapper';
import { getTokenFromKeychain } from './secrets';
import { OsInfo } from './os';

export interface DmpConfig {
  dmpApiUrl?: string;
  authUrl?: string;
  tokenUrl?: string;
  clientId?: string;
}

export const fetchDmpConfig = async (dmpBaseUrl: string, debug?: boolean): Promise<DmpConfig> => {
  try {
    if (debug) signale.debug(`Fetching config from ${dmpBaseUrl}/config.json...`);
    const response = await fetch(`${dmpBaseUrl}/config.json`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    const result: DmpConfig = {};
    if (data.apiUrl) result.dmpApiUrl = data.apiUrl;
    const authDomain = data.amplify?.Auth?.Cognito?.loginWith?.oauth?.domain;
    if (authDomain) {
      result.authUrl = `https://${authDomain}/oauth2/authorize`;
      result.tokenUrl = `https://${authDomain}/oauth2/token`;
    }
    const clientId = data.amplify?.Auth?.Cognito?.userPoolClientId;
    if (clientId) result.clientId = clientId;
    if (debug) signale.debug('Extracted dmp config overrides:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (debug) signale.error(`Failed to fetch DMP config from ${dmpBaseUrl}:`, msg);
    return {};
  }
};

export const loadFoldersConfig = async (
  foldersFile: string,
  debug: boolean,
  osInfo: OsInfo,
): Promise<FolderMapping[]> => {
  try {
    let fileData: string;
    if (foldersFile.startsWith('http://') || foldersFile.startsWith('https://')) {
      if (debug) signale.debug(`Fetching folders config from ${foldersFile}...`);
      const token = getTokenFromKeychain(debug, osInfo);
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(foldersFile, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      fileData = await response.text();
    } else {
      fileData = fs.readFileSync(foldersFile, 'utf8');
    }
    const parsedData = JSON.parse(fileData);
    if (Array.isArray(parsedData)) {
      return parsedData;
    }
    return parsedData.folders || [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read or parse ${foldersFile}. Please ensure the file exists/is reachable and is valid JSON. Details: ${msg}`,
    );
  }
};
