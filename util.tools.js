/* let mod = require('util.tools'); */

let energyDropsCache = null;

let tools = {
    getRoomStore: function(room) {
        let stor = room.storage;
        if (stor && _.sum(stor.store) > 0.9 * stor.storeCapacity && room.terminal) {
            stor = room.terminal;
        }
        if (!stor && 'altStoragePos' in room.memory.config) {
            stor = _(room.lookForAt(LOOK_STRUCTURES, room.memory.config.altStoragePos.x, room.memory.config.altStoragePos.y)).filter(
                (s) => {
                    return [STRUCTURE_CONTAINER, STRUCTURE_LINK].indexOf(s.structureType) >= 0;
                }
            ).value()[0];
        }
        return stor;
    },
    isRoomSafe: function(roomName) {
        if (!(roomName in Memory.rooms)) return false;
        if (!('status' in Memory.rooms[roomName])) return false;
        return Memory.rooms[roomName].status.safe;
    },
    markDismantleRoadsExceptPath: function(room, pos1, pos2) {
        let path = room.findPath(pos1, pos2, {ignoreCreeps: true});
        let roads = room.find(FIND_STRUCTURES, {filter: 
            (s) => s.structureType == STRUCTURE_ROAD && _(path).filter({x: s.pos.x, y: s.pos.y}).size() == 0
        });
        room.memory.dismantleStructures = roads.map((r) => r.id);
    },
    getRoomsAndSpawns: function() {
        let roomsWithSpawns = [];
        for (let spawnName in Game.spawns) {
            let spawn = Game.spawns[spawnName];
            let rName = spawn.room.name;
            let rs = roomsWithSpawns.find(function(x) { return x.room.name == rName; });
            if (rs) {
                rs.spawns.push(spawn);
            } else {
                roomsWithSpawns.push({room: spawn.room, spawns: [spawn]});
            }
        }
        return roomsWithSpawns;
    },
    loadPos: function(posFromMem) {
        if (posFromMem && ('x' in posFromMem) && ('y' in posFromMem) && ('roomName' in posFromMem)) {
            return new RoomPosition(posFromMem.x, posFromMem.y, posFromMem.roomName);
        } else {
            return null;
        }
    },
    countCreepsFromRoom: function(roleName, homeRoomName, conditions) {
        if (!conditions) {
            return _(Memory.creeps).filter({role: roleName, homeRoom: homeRoomName}).size();
        } else {
            conditions.role = roleName;
            conditions.homeRoom = homeRoomName;
            return _(Memory.creeps).filter(conditions).size();
        }
    },
    isPositionInsideRoom: function(pos, roomName) {
        return pos.roomName == roomName &&
               pos.x > 0 &&
               pos.y > 0 &&
               pos.x < 49 &&
               pos.y < 49;
    },
    avoidRoomEdges: function(pos) {
        return new RoomPosition(
                Math.min(48, Math.max(1, pos.x)),
                Math.min(48, Math.max(1, pos.y)),
                pos.roomName
            );
    },
    getRoomRefugeesCampPos: function(roomName) {
        let pos = this.loadPos(Memory.rooms[roomName].config.refugeesCampPos);
        if (!pos) {
            console.log('No refugeesCampPos in '+roomName);
            pos = new RoomPosition(25, 25, roomName);
        }
        return pos;
    },
    countParts: function(creeps, part) {
        let sum = 0;
        for (let i = 0; i< creeps.length; ++i) {
            sum += creeps[i].getActiveBodyparts(part);
        }
        return sum;
    },
    createBodyFromParts: function(parts) {
        let body = [];
        for (i in parts) {
            body = body.concat(new Array(parts[i].count).fill(parts[i].part));
        }
        return body;
    },
    createBodyRepeat: function(init, repeat, final, energyLimit) {
        let energyLeft = energyLimit - this.calcBodyCost(init) - this.calcBodyCost(final);
        let partsLeft = MAX_CREEP_SIZE - init.length - final.length;
        if (energyLeft < 0 || partsLeft < 0) return null;
        let repeatCost = this.calcBodyCost(repeat);
        let repeatParts = repeat.length;
        let body = init;
        while (energyLeft >= repeatCost && partsLeft >= repeatParts) {
            body = body.concat(repeat);
            energyLeft -= repeatCost;
            partsLeft -= repeatParts;
        }
        return body.concat(final);
    },
    calcBodyCost: function(body) {
        return _.sum(body.map((p)=>BODYPART_COST[p]));
    },
    markRoomManaged: function(homeRoomName, managedRoomName) {
        if (homeRoomName != managedRoomName) {
            if (!Memory.rooms[homeRoomName].managedRooms) {
                Memory.rooms[homeRoomName].managedRooms = {maxDrones: 1};
            }
        }

    },
    getStructureAt: function(posFromMem, structTypes) {
        if (!posFromMem) return undefined;
        let room = Game.rooms[posFromMem.roomName];
        if (!room) {
            return undefined;
        }
        return _(room.lookForAt(LOOK_STRUCTURES, posFromMem.x, posFromMem.y)).filter((s) => { return structTypes.indexOf(s.structureType) >= 0; } ).value()[0];
            
    },
    getDroppedResourceAtPos: function(posFromMem, resourceType) {
        let room = Game.rooms[posFromMem.roomName];
        if (!room) {
            return 0;
        }
        let drop = _(room.lookForAt(LOOK_RESOURCES, posFromMem.x, posFromMem.y)).filter({resourceType: resourceType}).value()[0];
        return drop?drop.amount:0;
            
    },
    findMostNeededTrans: function(allTrans, defaultDest) {
        let selectedTrans = null;
        let selectedTransTime = 0;
        for (let i in allTrans) {
            let trans = allTrans[i];
            if (!this.isRoomSafe(trans.fromPos.roomName)) continue;
            let dueInTicks = trans.nextSpawn - Game.time;
            if (dueInTicks < selectedTransTime) {
                selectedTrans = trans;
                selectedTransTime = dueInTicks;
            }
        }
        return selectedTrans;
    },
    findDamagedStructure: function(pos, selectedType, excludeIds) {
        let structToRepair;
        let structsToDismantle = ('dismantleStructures' in Memory.rooms[pos.roomName])?Memory.rooms[pos.roomName].dismantleStructures : [];
        let allExclusions = excludeIds?excludeIds.concat(structsToDismantle):structsToDismantle;
        structToRepair = pos.findClosestByPath(FIND_STRUCTURES, {
            filter: function(struct) {
                return struct.structureType == selectedType && struct.hits < struct.hitsMax * 0.9 && allExclusions.indexOf(struct.id) == -1;
            }
        });
        if (structToRepair) {
            return structToRepair;
        }
    },
    findDamagedStructureInRange: function(pos, range, selectedType, excludeIds) {
        let structsToRepair;
        if (excludeIds) {
            structsToRepair = pos.findInRange(FIND_STRUCTURES, range, {
                filter: function(struct) {
                    return struct.structureType == selectedType && struct.hits < struct.hitsMax * 0.9 && !(struct.id in excludeIds);
                }
            });
        } else {
            structsToRepair = pos.findInRange(FIND_STRUCTURES, range, {
                filter: function(struct) {
                    return struct.structureType == selectedType && struct.hits < struct.hitsMax * 0.9;
                }
            });
        }
        if (structsToRepair.length > 0) {
            return structsToRepair[0];
        }
    },
    pickupNearbyEnergyDrops: function(creep) {
        if (!energyDropsCache || energyDropsCache.time != Game.time) energyDropsCache = {};
        let room = creep.room;
        let roomName = room.name;
        if (!(roomName in energyDropsCache)) {
            energyDropsCache[roomName] = room.find(FIND_DROPPED_RESOURCES, {filter: (d) => d.resourceType == RESOURCE_ENERGY});
        }
        let drops = creep.pos.findInRange(energyDropsCache[roomName], 1);
        if (drops.length > 0) {
            creep.pickup(drops[0]);
            return drops[0].amount;
        }
        return 0;
    },
    pickupNearbyDrops: function(creep) {
        let drops = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1);
        if (drops.length > 0) {
            creep.pickup(drops[0]);
            return drops[0].amount;
        }
        return 0;
    },
    setupMine: function(homeRoom, minePos) {
        let minerMoves = Math.min(Math.floor( (homeRoom.energyCapacityAvailable - BODYPART_COST[CARRY] ) / (BODYPART_COST[WORK]*2 + BODYPART_COST[MOVE]) ), 3);
        let minerWork = minerMoves * 2;
        let minerCarry = 1;
        if (homeRoom.energyCapacityAvailable - BODYPART_COST[WORK]*minerWork - BODYPART_COST[MOVE]*minerMoves >= BODYPART_COST[CARRY]*2 ) {
            minerCarry = 2;
        }
        let minerRespawn = CREEP_LIFE_TIME - CREEP_SPAWN_TIME*(minerWork+minerCarry+minerMoves);
        let productionPerTick = Math.min(SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME, minerWork*HARVEST_POWER);
        console.log('Miner work: '+minerWork+', carry: '+minerCarry+', respawn: '+minerRespawn+' will produce per tick: '+productionPerTick);
        
        let stor = tools.getRoomStore(homeRoom);
        let distance = PathFinder.search(minePos, {pos: stor.pos, range: 1}, {ignoreCreeps: true}).path.length + 1;
        let transportSizeNeeded = Math.ceil(productionPerTick * 2 * distance * 1.1 / (2*CARRY_CAPACITY)); //+10% margin for safety
        let roomMaxCollectorSize = Math.min(Math.floor(homeRoom.energyCapacityAvailable / (2*BODYPART_COST[CARRY]+BODYPART_COST[MOVE])), 16);
        console.log('Distance: '+distance+', needed carry: '+transportSizeNeeded+', room allows transport up to: '+roomMaxCollectorSize+'M'+(roomMaxCollectorSize*2)+'C');
        let collectorCount = Math.ceil(transportSizeNeeded / roomMaxCollectorSize);
        let singleTransportSize = Math.ceil(transportSizeNeeded / collectorCount);
        console.log('Trans count: '+collectorCount+', size: '+singleTransportSize);
        let mineNo = homeRoom.memory.config.mines.push({pos: minePos, work: minerWork, carry: minerCarry, moves: minerMoves, respawn: minerRespawn})-1;
        let transNo = homeRoom.memory.config.trans.push({fromPos: minePos, count: collectorCount, carry: singleTransportSize*2, moves: singleTransportSize, nextSpawn: Game.time})-1;
        console.log('Created mine no '+mineNo+' and trans no '+transNo);
        console.log(JSON.stringify(homeRoom.memory.config.mines[mineNo]));
        console.log(JSON.stringify(homeRoom.memory.config.trans[transNo]));
        Memory.rooms[minePos.roomName].sign = '[Ypsilon Pact] Mining operations, no tresspassing!';
    },
    resizeTransports: function(homeRoom) {
        let stor = tools.getRoomStore(homeRoom);
        for (t in homeRoom.memory.config.trans) {
            let trans = homeRoom.memory.config.trans[t];
            if (trans.toPos) continue; //only resizing mine -> store
            let minePos = tools.loadPos(trans.fromPos);
            let productionPerTick = 10; // TODO: get mine, find output
            let distance = PathFinder.search(minePos, {pos: stor.pos, range: 1}, {ignoreCreeps: true}).path.length + 1;
            let transportSizeNeeded = Math.ceil(productionPerTick * 2 * distance * 1.1 / (2*CARRY_CAPACITY)); //+10% margin for safety
            let roomMaxCollectorSize = Math.min(Math.floor(homeRoom.energyCapacityAvailable / (2*BODYPART_COST[CARRY]+BODYPART_COST[MOVE])), 16);
            console.log('Distance: '+distance+', needed carry: '+transportSizeNeeded+', room allows transport up to: '+roomMaxCollectorSize+'M'+(roomMaxCollectorSize*2)+'C');
            trans.count = Math.ceil(transportSizeNeeded / roomMaxCollectorSize);
            trans.moves = Math.ceil(transportSizeNeeded / trans.count);
            trans.carry = trans.moves * 2;
            if (!('nextSpawn' in trans)) trans.nextSpawn = Game.time;
            console.log(JSON.stringify(trans));
        }
    },
    observeRoom: function(roomName) {
        let observers = _(Game.structures).filter({structureType: STRUCTURE_OBSERVER}).value();
        if (observers.length == 0) return 'no observer in empire';
        console.log(observers);
        for (let i=0;i<observers.length; i++) {
            let ret = observers[i].observeRoom(roomName);
            console.log('Observer in '+observers[i].room.name+' returned '+ret);
            if (ret == 0) {
                return 'Successfully observed from '+observers[i].room.name;
            }
        }
    },
    getCreepName : function(memory) {
        let role = (memory&&memory.role)?memory.role:'Creep';
        let name = role+'_'+(Memory.nextId++);
        if (Memory.nextId > 100000) {
            Memory.nextId = 1;
        }
        return name;
    },
    printRoomsStatus: function(printDetails) {
        for (let rn in Game.rooms) {
            let room = Game.rooms[rn];
            if (room.controller == null || !room.controller.my) continue;
            let rcl = room.controller.level;
            if (!rcl) continue;
            let terminalDescr = room.terminal?formatLimit(room.terminal.store.energy, Memory.rooms[rn].config.refillers.terminalEnergyLimit):'-';
            let freeDescr = room.terminal?formatLimit(TERMINAL_CAPACITY-_.sum(room.terminal.store), TERMINAL_CAPACITY):'-';
            let storeDescr = room.storage?room.storage.store.energy:'-';
            let queueDescr = room.memory.spawnQueue.length;
            let mineralDescr = room.memory.mineral.type+' -> '+((('sendSurplusTo' in room.memory.mineral)?room.memory.mineral.sendSurplusTo:'sell')+' when >'+room.memory.mineral.minAmount);
            let reactionDescr;
            if ('labs' in room.memory.config) {
                let reaction = room.memory.config.labs.react;
                let stock1 = room.terminal.store[reaction.reagent1];
                let stock2 = room.terminal.store[reaction.reagent2];
                reactionDescr = reaction.reagent1+'('+stock1+')+'+reaction.reagent2+'('+stock2+')->'+REACTIONS[reaction.reagent1][reaction.reagent2];
            } else {
                reactionDescr = 'none';
            }
            console.log(rn+': freeT: '+freeDescr+', t: '+terminalDescr+', s: '+storeDescr+', q: '+queueDescr+', m: '+mineralDescr+', r:'+reactionDescr);
            if (printDetails) this.printMines(rn);
        }
    },
    printRoomsCreepsSetup: function(printDetails) {
        for (let rn in Game.rooms) {
            let room = Game.rooms[rn];
            if (!room.controller || !room.controller.level) continue;
            let roomConfig = room.memory.config;
            let refillersDesc = roomConfig.refillers.count+'x'+roomConfig.refillers.maxSize+' fill '+roomConfig.refillers.fillContainers.length+' containers & terminal to '+roomConfig.refillers.terminalEnergyLimit;
            let dronesDesc = roomConfig.drones.count+'x'+roomConfig.drones.maxSize;
            let upgradersDesc = roomConfig.upgraders.spots.length+'/'+roomConfig.upgraders.limitWork+'@'+roomConfig.upgraders.minStoredEnergy+'+'+roomConfig.upgraders.minSurplusEnergyPerWork+'/W';
            console.log(rn+': r: '+refillersDesc+', d: '+dronesDesc+', u: '+upgradersDesc);
            for (mrn in roomConfig.maintainRooms) {
                console.log(' ->'+mrn+': '+JSON.stringify(roomConfig.maintainRooms[mrn]))
            }
        }
    },
    printMines: function(rn) {
        allMines = Memory.rooms[rn].config.mines;
        for (i in allMines) {
            console.log(i+': '+JSON.stringify(allMines[i]));
        }
    },
    formatNumber: function(num) {
        if (num >= 1e6) return (num/1e6).toFixed(2)+'M';
        if (num >= 1e3) return (num/1e3).toFixed(2)+'k';
        return num;
    },
    printStock: function(resource) {
        let stocks = {};
        _(Game.structures).filter(s=>
            (s.structureType == STRUCTURE_TERMINAL || s.structureType == STRUCTURE_STORAGE) &&
            (resource in s.store)
        ).forEach( s=> {
            let roomName = s.room.name;
            if (roomName in stocks) {
                stocks[roomName] += s.store[resource];
            } else {
                stocks[roomName] = s.store[resource];
            }
        }).value();
        let printed = 'Total: '+this.formatNumber(_.sum(stocks));
        for (let roomName in stocks) {
            printed += ', '+roomName+': '+this.formatNumber(stocks[roomName]);
        }
        return printed;
    },
    printStocks: function(resources) {
        for (let i in resources) {
            let resource = resources[i];
            console.log(resource+': '+this.printStock(resource));
        }
    }
}

let formatLimit = function(value, limit) {
    return value+'('+Math.round(value/limit*100)+'%)';
}

module.exports = tools;

global.tools = tools;
global.T1_MILITARY_BOOSTS = [ 'GO'  ,  'ZO'  ,  'LO'  ,  'KO'  ,  'UH'  ,  'ZH'  ];
global.T2_MILITARY_BOOSTS = [ 'GHO2',  'ZHO2',  'LHO2',  'KHO2',  'UH2O',  'ZH2O'];
global.T3_MILITARY_BOOSTS = ['XGHO2', 'XZHO2', 'XLHO2', 'XKHO2', 'XUH2O', 'XZH2O'];
global.T1_ECONOMY_BOOSTS = [ 'GH'  ,  'LH'  ];
global.T2_ECONOMY_BOOSTS = [ 'GH2O',  'LH2O'];
global.T3_ECONOMY_BOOSTS = ['XGH2O', 'XLH2O'];
global.BOOST_REAGENTS = ['O', 'H', 'OH', 'X'];
