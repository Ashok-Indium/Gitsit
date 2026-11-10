// #region rayfin:app-owned — copied verbatim by the Rayfin CLI; edit freely.
//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type {
  ConnectorConfig,
  ConnectorsRuntime,
} from '@microsoft/rayfin-connectors';
// #endregion rayfin:app-owned

/**
 * The app has no connectors. Its tables are in its own SQL database gitsit-test, which Fabric
 * does not allow as a connector; they are read and written through the Fabric GraphQL item
 * gitsit_test_gql instead (src/lib/fabric-data.ts). Owned by the app, so `rayfin connector add`
 * does not rewrite this file.
 */
export type AppConnectorsSchema = Record<string, never>;

export const connectorConfigs: Record<string, ConnectorConfig> = {};

export const connectorRuntimes: ConnectorsRuntime = {};
