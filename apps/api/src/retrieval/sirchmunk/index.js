const { sirchmunkSearch, getSirchmunkStatus } = require('./client');
const { mapSirchmunkItemsToEvidence } = require('./adapter');

module.exports = {
  sirchmunkSearch,
  getSirchmunkStatus,
  mapSirchmunkItemsToEvidence,
};
