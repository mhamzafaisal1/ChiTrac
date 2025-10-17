# ChiTrac API

The ChiTrac API is a Web Service and Application Programming Interface (API) for providing current, configuration, and historical information about networked Chicago Dryer (CD) equipment. Data is available in JSON format from all routes.

---

## Available Routes

### AC360 Data Ingestion Routes

#### `/api/alpha/ac360/post`

Receives and processes data from AC360 machines, including status updates, item counts, and stack information. This endpoint handles real-time data ingestion from AC360 equipment and manages machine and operator session tracking.

**Method:** POST  
**Auth:** Same as other `/api/alpha` routes  
**Idempotent:** No

**Request Body**

The endpoint accepts different types of data based on the presence of specific fields in the request body:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timestamp` | ISO 8601 timestamp (UTC) | No | Event timestamp. If future timestamp detected, clamped to current time. |
| `machineInfo` | Object | Yes | Machine identification and network information |
| `operatorInfo` | Object | Yes | Operator identification information |
| `programInfo` | Object | No | Program configuration (mode defaults to "ac360") |
| `status` | Object | No | Machine status information (triggers status processing) |
| `item` | Object | No | Item count information (triggers count processing) |
| `stack` | Object | No | Stack information (triggers stack processing) |

**Request Body Structure**

```json
{
  "timestamp": "2025-05-01T12:00:00.000Z",
  "machineInfo": {
    "serial": 67808,
    "name": "SPF1",
    "ipAddress": "192.168.1.100"
  },
  "operatorInfo": {
    "code": 135790,
    "name": "Lilliana Ashca"
  },
  "programInfo": {
    "mode": "ac360",
    "pace": 240
  },
  "status": {
    "code": 1,
    "name": "Running"
  }
}
```

**Data Processing Types**

The endpoint processes three types of data based on the presence of specific fields:

1. **Status Data** (`status` field present)
   - Updates machine and operator sessions
   - Manages session lifecycle (start/end)
   - Updates state ticker and state collections
   - Calculates runtime, work time, and time credits

2. **Count Data** (`item` field present)
   - Records item production counts
   - Updates state ticker with running status
   - Stores formatted count records

3. **Stack Data** (`stack` field present)
   - Processes stack-related information
   - Stores in ac360-stack collection

**Response Format**

**Success Response (200 OK)**

```json
{
  "receivedBody": {
    "timestamp": "2025-05-01T12:00:00.000Z",
    "machineInfo": {
      "serial": 67808,
      "name": "SPF1",
      "ipAddress": "192.168.1.100"
    },
    "operatorInfo": {
      "code": 135790,
      "name": "Lilliana Ashca"
    },
    "programInfo": {
      "mode": "ac360",
      "pace": 240
    },
    "status": {
      "code": 1,
      "name": "Running"
    }
  }
}
```

**No Body Response (200 OK)**

```json
"No body received"
```

**Field Reference**

**Machine Information**
- `machineInfo.serial` (integer) — Machine serial number
- `machineInfo.name` (string) — Machine name (e.g., "SPF1")
- `machineInfo.ipAddress` (string) — Machine IP address (auto-extracted from request)

**Operator Information**
- `operatorInfo.code` (integer) — Operator ID
- `operatorInfo.name` (string) — Operator full name

**Program Information**
- `programInfo.mode` (string) — Program mode (defaults to "ac360")
- `programInfo.pace` (number) — Production pace/standard

**Status Information**
- `status.code` (integer) — Status code (1 = Running, others = Various states)
- `status.name` (string) — Human-readable status name

**Item Information**
- `item.id` (integer) — Item ID (defaults to 0 if not provided)
- `item.name` (string) — Item name
- `item.sortNumber` (integer) — Lane/sort number

**Processing Details**

**Session Management**
- Machine sessions are tracked in the `machine-session` collection
- Operator sessions are tracked in the `operator-session` collection
- Sessions are automatically started when data is received for a new machine/operator
- Sessions are closed when status code indicates machine/operator is no longer active

**State Updates**
- All status updates are stored in the `state` collection
- The `stateTicker` collection maintains the current state of each machine
- State ticker is updated with the most recent status for each machine

**Count Processing**
- Item counts are stored in the `count` collection
- Counts are formatted with machine, operator, and item information
- Standard production rates are applied for time credit calculations

**Time Credit Calculations**
- Time credits are calculated based on item standards and production counts
- Standards are converted from PPM to PPH if less than 60
- Formula: `totalTimeCredit = totalCount * (standard / 3600)`

**Error Handling**

**Future Timestamp Correction**
- If incoming timestamp is in the future, it is automatically clamped to current time
- This prevents issues with AC360 devices that may have incorrect system clocks

**IP Address Extraction**
- Client IP address is automatically extracted from the request socket
- IP address is added to machine information for network tracking

**Edge Cases**

- If no request body is provided, returns "No body received"
- If request is not JSON format, returns the raw body data
- Machine name is automatically formatted as "SPF" + last character of machine name
- Operator sessions are processed asynchronously for each operator
- Session updates include runtime, work time, and time credit calculations

**Collections Updated**

- `ac360` — Raw AC360 data
- `ac360-status` — Status-specific data
- `ac360-count` — Count-specific data  
- `ac360-stack` — Stack-specific data
- `state` — All state updates
- `stateTicker` — Current machine states
- `machine-session` — Machine session tracking
- `operator-session` — Operator session tracking
- `count` — Formatted count records

**Example Requests**

**Status Update**
```bash
POST /api/alpha/ac360/post
Content-Type: application/json

{
  "timestamp": "2025-05-01T12:00:00.000Z",
  "machineInfo": {
    "serial": 67808,
    "name": "SPF1"
  },
  "operatorInfo": {
    "code": 135790,
    "name": "Lilliana Ashca"
  },
  "status": {
    "code": 1,
    "name": "Running"
  }
}
```

**Item Count**
```bash
POST /api/alpha/ac360/post
Content-Type: application/json

{
  "timestamp": "2025-05-01T12:05:00.000Z",
  "machineInfo": {
    "serial": 67808,
    "name": "SPF1"
  },
  "operatorInfo": {
    "code": 135790,
    "name": "Lilliana Ashca"
  },
  "programInfo": {
    "pace": 240
  },
  "item": {
    "id": 1,
    "name": "Pool Towel",
    "sortNumber": 1
  }
}
```

**Stack Information**
```bash
POST /api/alpha/ac360/post
Content-Type: application/json

{
  "timestamp": "2025-05-01T12:10:00.000Z",
  "machineInfo": {
    "serial": 67808,
    "name": "SPF1"
  },
  "operatorInfo": {
    "code": 135790,
    "name": "Lilliana Ashca"
  },
  "stack": {
    "height": 12,
    "items": ["Pool Towel", "Bath Towel"]
  }
}
```

**Versioning & Stability**

This route is part of the Alpha API; fields may be extended. Additions will be backward-compatible (additive).

Semantics of existing fields are stable; any breaking change will be versioned under a new path.
