import process from 'node:process'
import { Console } from "@hackbg/logs"
import { base64 } from "@hackbg/fadroma";
import { Sequelize, DataTypes, Op } from "sequelize"
import PG from "pg"
import { CHAIN_ID, DATABASE_URL } from "./config.js"
export { Sequelize, DataTypes, Op }

const console = new Console("DB");
const { DATE, TEXT, BLOB, JSONB, INTEGER, BOOLEAN, BIGINT } = DataTypes

const db = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: () => console.log,
  logQueryParameters: true,
  supportBigNumbers: true,
  dialectOptions: {
    application_name: 'undexer',
    keepAlive: true,
    statement_timeout: 60000,
    idle_in_transaction_session_timeout: 120000,
  }
})

export default db

export async function initDb () {
  let dbName
  let host
  try {
    const url = new URL(DATABASE_URL)
    const { username, password, hostname, port, pathname } = url
    host = url.host
    dbName = pathname.slice(1) || CHAIN_ID
    console.debug(`Connecting to ${host}...`)
    const pg = new PG.Client({ user: username, password, host: hostname, port })
    console.debug(`Connected to ${host}`)
    await pg.connect()
    console.debug(`Ensuring database "${dbName}" at ${host}...`)
    await pg.query(`CREATE DATABASE "${dbName}";`)
    console.debug(`Created database "${dbName}" at ${host}`)
  } catch (e) {
    if (e.code === '42P04') {
      console.debug(`Database "${dbName}" already exists.`)
    } else {
      if (e.code === 'ECONNREFUSED') {
        console.error(`Connection refused. Make sure Postgres is running at ${e.address}:${e.port}`)
      } else {
        console.error(e)
      }
      console.error(`Failed to create database "${dbName}". See above for details.`)
      process.exit(1)
    }
  }
  // Allow sorting strings as numbers.
  // See https://github.com/sequelize/sequelize/discussions/15529#discussioncomment-4601186
  try {
    console.debug(`Ensuring numeric collation in "${dbName}" at ${host}...`)
    await db.query(`CREATE COLLATION IF NOT EXISTS numeric (provider = icu, locale = 'en-u-kn-true')`)
  } catch (e) {
    console.error(e)
    console.warn('FIXME: CREATE COLLATION threw. This is normal only after first run.')
  }
}

export const IntegerPrimaryKey = (autoIncrement = false) => ({
  type:       INTEGER,
  allowNull:  false,
  unique:     true,
  primaryKey: true,
  autoIncrement
})

export const StringPrimaryKey = () => ({
  type:       TEXT,
  allowNull:  false,
  unique:     true,
  primaryKey: true,
})

const compoundPrimaryKey = (fields) => Object.fromEntries(
  Object.entries(fields).map(([key, value])=>[key, {
    ...value,
    unique:     false,
    primaryKey: true,
    allowNull:  false,
  }])
)

export const JSONField = name => ({
  type: JSONB,
  allowNull: false,
  set (value) {
    return this.setDataValue(name, JSON.parse(serialize(value)));
  },
})

export const NullableJSONField = name => ({
  type: JSONB,
  allowNull: true,
  set (value) {
    if (value === undefined) {
      this.setDataValue(name, null);
    }
    else {
      this.setDataValue(name, JSON.parse(serialize(value)));
    }
  },
})

export const VALIDATOR_STATES = [
  "BelowThreshold",
  "BelowCapacity",
  "Jailed",
  "Consensus",
  "Inactive"
]

const blockMeta = () => ({
  chainId:     { type: TEXT,    allowNull: false },
  blockHash:   { type: TEXT,    allowNull: false },
  blockHeight: { type: INTEGER, allowNull: false },
  blockTime:   { type: DATE },
})

export const PROPOSAL_STATUS = [
  "ongoing",
  "finished",
  "upcoming",
]

export const PROPOSAL_RESULT = [
  "passed",
  "rejected",
]

export const PROPOSAL_TALLY_TYPE = [
  "OneHalfOverOneThird",
  "TwoThirds",
  "LessOneHalfOverOneThirdNay"
]

export const

  ErrorLog = db.define('error_log', {
    id:        IntegerPrimaryKey(true),
    timestamp: { type: DATE },
    message:   { type: TEXT },
    stack:     JSONField('stack'),
    info:      NullableJSONField('info'),
  }),

  Epoch = db.define('epoch', {
    id:         IntegerPrimaryKey(true),
    totalStake: { type: BIGINT },
    parameters: JSONField('parameters')
  }),

  Validator = db.define('validator', {
    ...compoundPrimaryKey({
      epoch:          { type: INTEGER, },
      namadaAddress:  { type: TEXT, },
    }),
    publicKey:        { type: TEXT, allowNull: true },
    consensusAddress: { type: TEXT, allowNull: true },
    votingPower:      { type: TEXT, allowNull: true },
    proposerPriority: { type: TEXT, allowNull: true },
    metadata:         NullableJSONField('metadata'),
    commission:       NullableJSONField('commission'),
    stake:            { type: TEXT, allowNull: true },
    state:            NullableJSONField('state')
  }),

  Block = db.define('block', {
    ...blockMeta(),
    epoch:        { type: INTEGER },
    blockHash:    StringPrimaryKey(),
    blockHeader:  JSONField('blockHeader'),
    rpcResponses: JSONField('rpcResponses'),
    blockData:    NullableJSONField('blockData'),
    blockResults: NullableJSONField('blockResults'),
  }),

  Transaction = db.define('transaction', {
    ...blockMeta(),
    txHash: StringPrimaryKey(),
    txTime: { type: DATE },
    txData: JSONField('txData'),
  }),

  Proposal = db.define('proposal', {
    id:       IntegerPrimaryKey(),
    content:  NullableJSONField('content'),
    metadata: NullableJSONField('metadata'),
    result:   NullableJSONField('result'),
    initTx:   { type: TEXT, allowNull: true }
  }),

  ProposalWASM = db.define('proposal_wasm', {
    id:       IntegerPrimaryKey(),
    codeKey:  { type: TEXT },
    wasm:     { type: BLOB },
  }),

  Vote = db.define("vote", {
    ...compoundPrimaryKey({
      proposal:    { type: INTEGER, },
      validator:   { type: TEXT,    allowNull: true },
      delegator:   { type: TEXT,    allowNull: true },
      isValidator: { type: BOOLEAN, allowNull: true },
    }),
    data:   { type: TEXT, },
    voteTx: { type: TEXT, allowNull: true },
    power:  { type: TEXT, allowNull: true },
    height: { type: INTEGER, allowNull: true },
    epoch:  { type: INTEGER, allowNull: true },
  });

export function logErrorToDB (error, info) {
  return ErrorLog.create({
    timestamp: new Date(),
    message:   error?.message,
    stack:     error?.stack,
    info
  })
}

export async function withErrorLog (callback, info) {
  try {
    return Promise.resolve(callback())
  } catch (error) {
    console.error('Logging error to database:', error)
    await logErrorToDB(error, info)
    throw error
  }
}

export function serialize (data) {
  return JSON.stringify(data, stringifier);
}

export function stringifier (_, value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return base64.encode(value);
  }
  return value;
}

export function atomic (transaction, operation) {
  if (transaction) {
    return operation(transaction)
  } else {
    return db.transaction(transaction=>callback(transaction))
  }
}
