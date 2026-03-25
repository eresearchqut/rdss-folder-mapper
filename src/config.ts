import fs from 'fs';
import signale from 'signale';
import { FolderMapping } from './mapper';
import { getTokenFromKeychain } from './secrets';
import { OsInfo } from './os';

export interface DmpConfig {
  clientId: string;
  apiUrl: string;
  callbackUrls: string[];
  domain: string;
  scopes: string[];
}

export const fetchDmpConfig = async (dmpBaseUrl: string, debug?: boolean): Promise<DmpConfig> => {
    if (debug) signale.debug(`Fetching config from ${dmpBaseUrl}/cli.json...`);
    const response = await fetch(`${dmpBaseUrl}/cli.json`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const cliConfig = (await response.json()) as DmpConfig;
    if (debug) signale.debug('Cli config:', JSON.stringify(cliConfig, null, 2));
    return cliConfig;
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
