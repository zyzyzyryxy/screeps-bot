const posEquals = function(pos1, pos2) {
    return (pos1.roomName == pos2.roomName) && (pos1.x == pos2.x) && (pos1.y == pos2.y);
}

const getRoomIdx = function(roomName, path, optPrevIdx) {
    if (optPrevIdx != null) {
        let segment = path.seg[optPrevIdx];
        if (segment != null && segment.room == roomName) return optPrevIdx;
        segment = path.seg[optPrevIdx + 1];
        if (segment != null && segment.room == roomName) return optPrevIdx + 1;
    }
    for (let idx = path.seg.length - 1; idx >= 0; --idx) {
        let segment = path.seg[idx];
        if (segment != null && segment.room == roomName) return idx;
    }
    return null;
}

const getPosIdx = function(pos, segment, optPrevIdx) {
    if (optPrevIdx != null) {
        let step = segment.steps[optPrevIdx];
        if ((step != null) && (step.x == pos.x) && (step.y == pos.y)) return optPrevIdx;
        step = segment.steps[optPrevIdx + 1];
        if ((step != null) && (step.x == pos.x) && (step.y == pos.y)) return optPrevIdx + 1;
    }
    for (let idx = segment.steps.length - 1; idx >= 0; --idx) {
        let step = segment.steps[idx];
        if ((step != null) && (step.x == pos.x) && (step.y == pos.y)) return idx;
    }
    return null;
}

const getPosAtIdx = function(path, roomIdx, posIdx) {
    if (path == null) return null;
    let segment = path.seg[roomIdx];
    if (segment == null) return null;
    let xy = segment.steps[posIdx];
    if (xy == null) return null;
    return new RoomPosition(xy.x, xy.y, segment.room);
}

const getLastStep = function(segment) {
    return _.last(segment.steps);
}

const visibleOnlyRoomCallback = function(roomName) {
    let room = Game.rooms[roomName];
    if (room == null) return false;
    if (room.defaultCostMatrix != null) return room.defaultCostMatrix;
    let matrix = new PathFinder.CostMatrix;
    room.find(FIND_STRUCTURES).forEach(function(struct) {
        if (struct.structureType == STRUCTURE_ROAD) {
            matrix.set(struct.pos.x, struct.pos.y, 1);
        } else if (!(struct.structureType == STRUCTURE_CONTAINER || struct.structureType == STRUCTURE_RAMPART && struct.my )) {
            matrix.set(struct.pos.x, struct.pos.y, 0xff);
        }
    });
    room.defaultCostMatrix = matrix;
    return matrix;
}

const visibleOrTerrainOnlyRoomCallback = function(roomName) {
    let matrix = new PathFinder.CostMatrix;
    let room = Game.rooms[roomName];
    if (room == null) return matrix;
    if (room.defaultCostMatrix != null) return room.defaultCostMatrix;
    room.find(FIND_STRUCTURES).forEach(function(struct) {
        if (struct.structureType == STRUCTURE_ROAD) {
            matrix.set(struct.pos.x, struct.pos.y, 1);
        } else if (struct.structureType !== STRUCTURE_CONTAINER) {
            matrix.set(struct.pos.x, struct.pos.y, 0xff);
        }
    });
    room.defaultCostMatrix = matrix;
    return matrix;
}

const findPathPart = function(origin, waypoint) {
    console.log('findPathPart('+origin+', '+waypoint+')');
    let result = PathFinder.search(origin, waypoint, { maxRooms: 1, roomCallback: visibleOnlyRoomCallback });
    console.log('search returned '+JSON.stringify(result));
    if (result.incomplete) {
        console.log('returning incomplete');
        return {incomplete: true};
    }
    const retVal = {
        incomplete: false,
        steps: result.path.map( pos => {
            return {x: pos.x, y: pos.y};
        })
    }
    console.log('returning: '+JSON.stringify(retVal));
    return retVal;
}

const findLrPath = function(origin, destination) {
    console.log('findLrPath('+origin+', '+destination+')');
    if (origin.roomName == destination.roomName) {
        const retVal = {
            target: destination,
            seg: [ {
                room: destination.roomName,
                steps: findPathPart(origin, destination).steps
            } ]
        }
        console.log('returning short path: '+JSON.stringify(retVal));
        return retVal;
    }
        
    let route = Game.map.findRoute(origin.roomName, destination.roomName, { routeCallback: function(roomName, fromRoomName) {
        if(Memory.roomsToAvoid.indexOf(roomName) != -1) {
            return Infinity;
        }
        return (new RegExp('((W|E)[0-9]*0.*|(W|E)[0-9]*(N|S)[0-9]*0)')).test(roomName)?2:3;
    }});
    let rooms = [origin.roomName].concat(route.map(r=>r.room));
    console.log('Route through '+rooms);
    
    let result = PathFinder.search(origin, destination, {
        roomCallback: function(roomName) {
            return (rooms.indexOf(roomName) == -1) ? false : visibleOrTerrainOnlyRoomCallback(roomName);
        }
    });
    console.log('Search result: '+JSON.stringify(result));
    
    let path = {target: destination, seg: []};
    let tmpSegment = { room: origin.roomName, steps: [ {x: origin.x, y: origin.y} ]};
    for (let pos of result.path) {
        if (pos.roomName != tmpSegment.room) {
            path.seg.push(tmpSegment);
            tmpSegment = { room: pos.roomName, steps: []};
        }
        tmpSegment.steps.push({ x: pos.x, y: pos.y });
    }
    path.seg.push(tmpSegment);
    console.log('Returning: '+JSON.stringify(path));
    return path;
    
}

module.exports = {
    run: function(creep, targetPos) {
//        console.log('Moving '+creep+' to '+targetPos);
        if (creep.fatigue > 0) return;
        
        let path = creep.memory._lrPath;
        if (path != null && !posEquals(targetPos, path.target)) {
            path = null;
        }
        // update indices if still on path, remove path if not on it
        if (path != null) {
            creep.memory._lrRoomIdx = getRoomIdx(creep.room.name, path, creep.memory._lrRoomIdx);
            if (creep.memory._lrRoomIdx != null) {
                let pathSeg = path.seg[creep.memory._lrRoomIdx];
                creep.memory._lrPosIdx = getPosIdx(creep.pos, pathSeg, creep.memory._lrPosIdx);
                if (creep.memory._lrPosIdx == null) {
                    // not on segment, but correct room - maybe just repath to the exit
                    let dest = getLastStep(pathSeg);
                    let searchResult = findPathPart(creep.pos, dest);
                    if (searchResult.incomplete) {
                        path = null;
                    } else {
                        path.seg[creep.memory._lrRoomIdx].steps = searchResult.steps;
                        creep.memory._lrPosIdx = 0;
                    }
                }
            } else {
                path = null;
            }
        }
        if (path == null) {
            creep.memory._lrPath = path = findLrPath(creep.pos, targetPos);
            creep.memory._lrRoomIdx = 0;
            creep.memory._lrPosIdx = 0;
        }
        // hopefully there is a path now
        // check if creep moved last time, if stuck then... move blocking creep? repath to next exit? a few steps forward?
        // also handle situation when teleported back to previous room eg. because of fatigue
        // finally, move
        
        let nextPos = getPosAtIdx(path, creep.memory._lrRoomIdx, creep.memory._lrPosIdx + 1);
        if (nextPos != null) {
            let dir = creep.pos.getDirectionTo(nextPos.x, nextPos.y);
            return creep.move(dir);
        }
    }
};