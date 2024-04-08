import sequelizer from "../../db/index.js";
import { DataTypes } from "sequelize";

const ClaimRewards = sequelizer.define('cntclaim_rewards', {
    validator: {
        type: DataTypes.TEXT,
        
    },
    source: {
        type: DataTypes.TEXT,
        
    },
});

export default ClaimRewards;