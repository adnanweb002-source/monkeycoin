# 🧩 Binary Tree User Registration & Placement Flow

This document explains how a new user is registered and placed into the **binary tree** in our MLM financial system.  
It covers both **auto-placement** (system finds the next vacant position) and **manual placement** (user/upline chooses position).

---

## 1️⃣ Flowchart – Binary Tree Signup & Placement

```mermaid
flowchart TD
    A["User opens referral link e.g. ?ref=SPONSOR_ID"] --> B["Frontend loads signup form with sponsor pre-filled"]
    B --> C["User submits registration form (username, email, password)"]
    C --> D["Auth Service validates input and hashes password"]
    D --> E["Fetch sponsor details using SPONSOR_ID"]
    E --> F{"Placement Type?"}
    F -->|Auto Placement| G["Find first vacant LEFT or RIGHT position under sponsor"]
    F -->|Manual Placement| H["Use provided parent_id and position"]
    G --> I["Check if (parent_id, position) is vacant"]
    H --> I
    I -->|Vacant| J["Begin DB Transaction → Create new user with sponsor_id, parent_id, position, status=INACTIVE"]
    I -->|Occupied| I2["Return error: Position already filled"]
    J --> K["Initialize 4 wallets (F, I, M, Bonus) for the new user"]
    K --> L["Commit Transaction"]
    L --> M["Return success response (userId, sponsorId, placement info)"]
    M --> N["Frontend redirects to login page"]
    N --> O["User sees placement details on dashboard"]
    O --> P["Binary tree updated successfully"]
```

---

## 2️⃣ Sequence Diagram – Signup (Auto + Manual Placement)

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant AUTH as Auth Service (NestJS)
    participant DB as PostgreSQL (Prisma)
    participant TREE as BinaryTreeService
    participant WALLET as WalletService

    %% --- Referral & Registration ---
    U->>FE: Clicks referral link e.g. ?ref=SPONSOR_ID
    FE->>AUTH: POST /auth/register {username, email, password, sponsorId, parentId?, position?}

    %% --- Auth validation & sponsor lookup ---
    AUTH->>DB: Validate sponsorId exists
    DB-->>AUTH: Sponsor details found

    %% --- Placement type decision ---
    AUTH->>TREE: Request placement {sponsorId, parentId?, position?}
    TREE->>TREE: Check if parentId and position provided

    alt Manual Placement
        TREE->>DB: Validate (parent_id, position) is vacant
        DB-->>TREE: Vacant slot confirmed
        TREE->>DB: Begin Transaction
        TREE->>DB: INSERT new user with parent_id, sponsor_id, position, status=INACTIVE
        DB-->>TREE: New user ID
    else Auto Placement
        TREE->>DB: Find first vacant LEFT/RIGHT spot under sponsor
        DB-->>TREE: Available parentId + position
        TREE->>DB: Begin Transaction
        TREE->>DB: INSERT new user with derived parent_id, sponsor_id, position
        DB-->>TREE: New user ID
    end

    %% --- Wallet initialization ---
    TREE->>WALLET: Initialize 4 wallets (F, I, M, Bonus)
    WALLET-->>TREE: Wallet creation success
    TREE->>DB: Commit Transaction

    %% --- Response handling ---
    TREE-->>AUTH: Placement success (userId, parentId, position)
    AUTH-->>FE: Registration success (user info + placement)
    FE-->>U: Show confirmation and login option
```

---

## 3️⃣ Explanation

### 🔹 Auto Placement

* Triggered when user registers via referral link only.
* The system finds the **next available LEFT or RIGHT** position under their sponsor.
* Prevents manual errors and ensures balanced binary tree growth.

### 🔹 Manual Placement

* Triggered when an existing member clicks a **vacant node** in their binary tree UI.
* The frontend sends `parentId` and `position` explicitly in the registration payload.
* The backend verifies that the spot is still vacant before creating the new user.

### 🔹 Transaction Handling

All user creation operations (including wallet initialization) occur inside a single **database transaction**:

* If any step fails (duplicate email, spot filled, DB issue), the transaction rolls back.
* Guarantees that no “half-created” user or wallet exists.

### 🔹 Wallet Initialization

Every new user gets 4 wallets automatically:

1. **F-Wallet** — Fund deposits.
2. **I-Wallet** — Income (referral, binary).
3. **M-Wallet** — ROI payouts from packages.
4. **Bonus Wallet** — Rank & rewards.

### 🔹 Data Constraints

Ensure data integrity:

```sql
CREATE UNIQUE INDEX unique_parent_position ON users(parent_id, position);
```

This prevents two members from being placed in the same left/right slot under a single parent.

---

## 4️⃣ Summary

| Step | Description                                   | Service            |
| ---- | --------------------------------------------- | ------------------ |
| 1    | User clicks referral link with sponsor ID     | Frontend           |
| 2    | User submits registration form                | Auth Service       |
| 3    | System validates sponsor and checks placement | BinaryTreeService  |
| 4    | New user created atomically with wallet setup | DB + WalletService |
| 5    | Success response sent to frontend             | Auth Service       |
| 6    | Binary tree view updated in dashboard         | Frontend           |

---

✅ **Next:**
After placement, package purchases trigger **BV propagation** up the tree and **binary income calculations**.
This will be detailed in the next document:
`binary-tree-bv-propagation.md`.
