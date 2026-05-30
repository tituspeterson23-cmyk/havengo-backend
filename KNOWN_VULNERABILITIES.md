# Known Vulnerabilities in HavenGo Backend

## Overview
This document tracks known security vulnerabilities in the HavenGo backend that are currently accepted risks due to compatibility constraints.

## Active Vulnerabilities

### UUID Buffer Bounds Check Issues
- **Severity**: Moderate
- **Affected Package**: uuid (<11.1.1)
- **CVE References**: GHSA-w5hq-g745-h8pq
- **Description**: Missing buffer bounds check in v3/v5/v6 when buf is provided
- **Affected Dependencies**:
  - @google-cloud/storage → gaxios/teeny-request → uuid
  - @google-cloud/firestore → google-gax → uuid
- **Current Versions**:
  - uuid: 14.0.0 (direct dependency - not vulnerable)
  - @google-cloud/firestore: 7.11.6
  - @google-cloud/storage: 7.19.0
  - firebase-admin: 13.10.0

### Why These Are Not Fixed
The vulnerabilities exist in transitive dependencies of firebase-admin@13.10.0. Fixing them would require:
1. Updating @google-cloud/firestore and @google-cloud/storage to versions that use uuid>=11.1.1
2. However, firebase-admin@13.10.0 has strict peer dependencies on specific versions of these packages
3. No version of firebase-admin >13.10.0 is currently available
4. Attempting to fix via `npm audit fix --force` would downgrade firebase-admin to 10.3.0, which is incompatible with the Neon PostgreSQL setup

### Risk Assessment
- **Impact**: Low to Moderate
- **Exploitability**: Requires specific conditions where attacker-controlled buffer is passed to uuid v3/v5/v6 functions
- **Attack Surface**: Internal Google Cloud library usage, not directly exposed in application code
- **Mitigation**: These are development tooling vulnerabilities in trusted Google libraries with no direct user input paths

### Monitoring Plan
- Monthly check for firebase-admin updates
- Quarterly review of Google Cloud dependency updates
- Immediate action if high/critical vulnerabilities are discovered

## Compatibility Notes
- Firebase-admin 13.10.0 is required for Neon PostgreSQL integration
- Earlier versions (<11.0.0) lack necessary features for current implementation
- No newer versions (>13.10.0) are currently published

## Last Reviewed
May 29, 2026