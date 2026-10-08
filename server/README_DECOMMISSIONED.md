# ResQNet Unified Backend Consolidation Notice

⚠️ **DO NOT RUN THIS SERVER DIRECTLY** ⚠️

As part of the ResQNet architectural consolidation, there is **ONE shared Node.js/Express backend** running on **Port 5000** and **ONE shared MongoDB Atlas database**:

- **Active Unified Server Path**: `D:\Projects\R_Victim\server`
- **Victim Client Path**: `D:\Projects\R_Victim\client`
- **Responder / Admin Client Path**: `D:\Projects\R_Resque\client`

Both client applications connect to `http://localhost:5000`. Running a second server inside `D:\Projects\R_Resque\server` is neither required nor permitted.
