var getLinkOrMakeConstrictionSite = function(room, posFromMem) {
    var structs = room.lookForAt(LOOK_STRUCTURES, posFromMem.x, posFromMem.y);
    var constructionSite = null;
    for (var s = structs.length - 1; s>=0; --s) {
        var struct = structs[s];
        if (struct.structureType == STRUCTURE_LINK) return struct;
    }
    room.createConstructionSite(posFromMem.x, posFromMem.y, STRUCTURE_LINK);
    return null;
}

module.exports = {
    run: function(room) {
        if (!('config' in room.memory)) return;
        if (!('links' in room.memory.config)) return;
        var linksConfig = room.memory.config.links;
        if (!('list' in linksConfig)) linksConfig.list = [];
        if (!('operations' in linksConfig)) linksConfig.operations = [];
        var linkPositions = linksConfig.list;
        var links = [];
        for (var i = linkPositions.length - 1; i >= 0; --i) {
            links[i] = getLinkOrMakeConstrictionSite(room, linkPositions[i]);
        }
        var linkOperations = linksConfig.operations;
        for (var i = linkOperations.length - 1; i>=0; --i) {
            var fromLink = links[linkOperations[i].from];
            var toLink = links[linkOperations[i].to];
            if (fromLink && toLink && fromLink.cooldown == 0) {
                var energyToTransferNet = fromLink.energy * (1-LINK_LOSS_RATIO);
                var spaceInTarget = toLink.energyCapacity - toLink.energy;
                if (spaceInTarget >= energyToTransferNet && energyToTransferNet > 0) {
                    fromLink.transferEnergy(toLink);
                }
            }
        }
    }
};