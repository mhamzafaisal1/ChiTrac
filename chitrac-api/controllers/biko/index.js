/*** alpha API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require("express");
const config = require("../../modules/config");
const router = express.Router();
const { DateTime, Duration, Interval } = require("luxon"); //For handling dates and times
const ObjectId = require("mongodb").ObjectId;
const startupDT = DateTime.now();

module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const db = server.db;
  const logger = server.logger;
  

  router.get("/timestamp", (req, res, next) => {
    res.json(startupDT);
  });

  router.get("/currentTime", async (req, res, next) => {
    const currentDT = DateTime.now();
    const formatString = "yyyy-LL-dd-TT.SSS";
    const responseJSON = {
      currentTime: currentDT.toUTC().toFormat(formatString),
      currentLocalTime: currentDT.toFormat(formatString),
      timezone: currentDT.toFormat("z"),
      timezoneOffset: currentDT.toFormat("ZZZ"),
    };
    res.json(responseJSON);
  });

  router.post("/versa", async (req, res, next) => {
    const currentDateTime = new Date();
    let bodyJSON = Object.assign({}, req.body);
    if (bodyJSON.timestamp) {
      bodyJSON.timestamp = new Date(DateTime.fromISO(bodyJSON.timestamp + "Z"));
      /** TEMPORARY FIX for future timestamps coming from AC360s on boot,  */
      if (bodyJSON.timestamp > currentDateTime) {
        bodyJSON.timestamp = currentDateTime;
      }
    }

    let storeJSON = Object.assign({}, bodyJSON);
    /*if (req.socket.remoteAddress) {
      const ipStrings = req.socket.remoteAddress.split(":");
      storeJSON.machineInfo["ipAddress"] = "" + ipStrings[ipStrings.length - 1];
    }
    const machine = Object.assign({}, storeJSON.machineInfo);
    const program = Object.assign({ mode: "ac360" }, storeJSON.programInfo);
    const operators = [
      { id: storeJSON.operatorInfo.code, name: storeJSON.operatorInfo.name },
    ];*/

    let collection = db.collection("versa");
    /*if (storeJSON.status) {
      collection = db.collection("ac360-status");

      const status = Object.assign({}, storeJSON.status);

      const state = {
        timestamp: storeJSON.timestamp,
        machine: {
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operators: operators,
        status: status,
      };

      const stateTickerResult = await db
        .collection("stateTicker")
        .replaceOne({ "machine.serial": machine.serial }, state, {
          upsert: true,
        });
      const stateResult = await db.collection("state").insertOne(state);

      const machineSessionArray = await db.collection('machine-session').find({ 'machine.serial': machine.serial, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
        if (machineSessionArray.length) {
            let session = machineSessionArray[0];
            const sessionID = session['_id'];
            if (stateType == 'status' && state.status.code != 1) {
                //Open session needs to close
                const now = new Date.now();
                const standard = 240;

                const runtime = now - session.timestamps.start;
                const workTime = runtime * 2;
                const totalCount = session.counts.length;
                const totalCountByItem = [totalCount];
                const totalTimeCredit = totalCount * (standard / 3600);
                const timeCreditByItem = [totalTimeCredit];

                const update = {
                    '$set': {
                        'timestamps.end': now,
                        'endState': state,
                        'program': program,
                        'runtime': runtime,
                        'workTime': workTime,
                        'totalCount': totalCount,
                        'totalCountByItem': totalCountByItem,
                        'totalTimeCredit': totalTimeCredit,
                        'timeCreditByItem': timeCreditByItem
                    },
                    '$push': {
                        'states': state
                    }
                }
                const updatedSession = await db.collection('machine-session').updateOne({ '_id': sessionID }, update);
            } else {
                //Open session for this machine exists and is open, append
                const now = new Date.now();
                const standard = 240;

                const runtime = now - session.timestamps.start;
                const workTime = runtime * 2;
                const totalCount = session.counts.length;
                const totalCountByItem = [totalCount];
                const totalTimeCredit = totalCount * (standard / 3600);
                const timeCreditByItem = [totalTimeCredit];

                const update = {
                    '$set': {
                        'program': program,
                        'items': items,
                        'runtime': runtime,
                        'workTime': workTime,
                        'totalCount': totalCount,
                        'totalCountByItem': totalCountByItem,
                        'totalTimeCredit': totalTimeCredit,
                        'timeCreditByItem': timeCreditByItem
                    },
                    '$push': {
                        'states': state
                    }
                }
                const updatedSession = await db.collection('machine-session').updateOne({ '_id': sessionID }, update);
            }
        } else {
            //Session doesn't exist, start one
            const newSession = {
                timestamps: {
                    start: new Date.now()
                },
                counts: [],
                misfeeds: [],
                states: [state],
                program: program,
                items: items,
                operators: operators,
                startState: state,
                machine: machine
            }
            const insertNewSession = await db.collection('machine-session').insertOne(newSession);
        }

        operators.forEach(async (operator) => {
            const operatorSessionArray = await db.collection('operator-session').find({ 'machine.serial': machine.serial, 'operator.id': operator.id, 'timestamps.end': null }).sort({ 'timestamps.start': -1 }).limit(1).toArray();
            if (operatorSessionArray.length) {
                let session = operatorSessionArray[0];
                const sessionID = session['_id'];
                if (stateType == 'status' && state.status.code != 1) {
                    //Open session needs to close
                    const now = new Date.now();
                    const itemDefinition = getItemDefinition(item.id);
                    const standard = itemDefinition ? itemDefinition.standard : 180;

                    const runtime = now - session.timestamps.start;
                    const workTime = runtime * 2;
                    const totalCount = session.counts.length;
                    const totalCountByItem = [totalCount];
                    const totalTimeCredit = totalCount * (standard / 3600);
                    const timeCreditByItem = [totalTimeCredit];
                    const update = {
                        '$set': {
                            'timestamps.end': new Date.now(),
                            'endState': state,
                            'program': program,
                            'runtime': runtime,
                            'workTime': workTime,
                            'totalCount': totalCount,
                            'totalCountByItem': totalCountByItem,
                            'totalTimeCredit': totalTimeCredit,
                            'timeCreditByItem': timeCreditByItem
                        },
                        '$push': {
                            'states': state
                        }
                    }
                    const updatedSession = await db.collection('operator-session').updateOne({ '_id': sessionID }, update);
                } else {
                    const now = new Date.now();
                    const itemDefinition = getItemDefinition(item.id);
                    const standard = itemDefinition ? itemDefinition.standard : 180;

                    const runtime = now - session.timestamps.start;
                    const workTime = runtime * 2;
                    const totalCount = session.counts.length;
                    const totalCountByItem = [totalCount];
                    const totalTimeCredit = totalCount * (standard / 3600);
                    const timeCreditByItem = [totalTimeCredit];
                    //Open session for this operator exists and is open, append
                    const update = {
                        '$set': {
                            'program': program,
                            'items': items,
                            'program': program,
                            'runtime': runtime,
                            'workTime': workTime,
                            'totalCount': totalCount,
                            'totalCountByItem': totalCountByItem,
                            'totalTimeCredit': totalTimeCredit,
                            'timeCreditByItem': timeCreditByItem
                        },
                        '$push': {
                            'states': state
                        }
                    }
                    const updatedSession = await db.collection('operator-session').updateOne({ '_id': sessionID }, update);
                }
            } else {
                //Session doesn't exist, start one
                const newSession = {
                    timestamps: {
                        start: new Date.now()
                    },
                    counts: [],
                    misfeeds: [],
                    states: [state],
                    program: program,
                    items: items,
                    operator: operator,
                    startState: state,
                    machine: machine
                }
                const insertNewSession = await db.collection('operator-session').insertOne(newSession);
            }
        });
    } else if (storeJSON.item) {
      collection = db.collection("ac360-count");

      const operator = Object.assign({}, storeJSON.operatorInfo);
      const item = Object.assign({}, storeJSON.item);

      const formattedCount = {
        timestamp: storeJSON.timestamp,
        machine: {
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operator: {
          id: operator.code,
          name: operator.name,
        },
        item: {
          id: item.id ? item.id : 0,
          //count: item.count,
          name: item.name,
          standard: program.pace,
        },
        station: 1,
        lane: item.sortNumber,
      };

      const insertFormattedCount = await db
        .collection("count")
        .insertOne(formattedCount);

      const state = {
        timestamp: storeJSON.timestamp,
        machine: {
          serial: machine.serial,
          name: "SPF" + machine.name.slice(-1),
          ipAddress: machine.ipAddress,
        },
        program: program,
        operators: operators,
        status: {
          code: 1,
          name: "System_Running",
        },
      };

      const result = await db
        .collection("stateTicker")
        .replaceOne({ "machine.serial": machine.serial }, state, {
          upsert: true,
        });
    } else if (storeJSON.stack) {
      collection = db.collection("ac360-stack");
    }*/
    const result = await collection.insertOne(storeJSON);

    if (req.is("application/json")) {
      res.json({ receivedBody: storeJSON });
    } else if (req.body) {
      res.send(storeJSON);
    } else {
      res.json("No body received");
    }
  });

  return router;
}
