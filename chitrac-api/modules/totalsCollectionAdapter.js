const {
  isTotalsCollection,
  translateTotalsFilter,
  translateTotalsPath,
  translateTotalsProjection,
  translateTotalsSort,
  legacyAliasStage,
  normalizeTotalsDocument,
} = require("../utils/totalsSchema");

function wrapCursor(cursor) {
  return new Proxy(cursor, {
    get(target, property) {
      if (property === "toArray") {
        return async () => (await target.toArray()).map(normalizeTotalsDocument);
      }
      if (property === "next") {
        return async () => normalizeTotalsDocument(await target.next());
      }
      if (property === "project") {
        return (projection) => wrapCursor(target.project(translateTotalsProjection(projection)));
      }
      if (property === "sort") {
        return (sort, direction) =>
          wrapCursor(target.sort(translateTotalsSort(sort), direction));
      }
      const value = target[property];
      if (typeof value !== "function") return value;
      return (...args) => {
        const next = value.apply(target, args);
        return next === target ? wrapCursor(target) : next;
      };
    },
  });
}

function wrapTotalsCollection(collection) {
  return new Proxy(collection, {
    get(target, property) {
      if (property === "find") {
        return (filter = {}, options = {}) =>
          wrapCursor(target.find(translateTotalsFilter(filter), {
            ...options,
            projection: translateTotalsProjection(options.projection),
            sort: translateTotalsSort(options.sort),
          }));
      }
      if (property === "findOne") {
        return async (filter = {}, options = {}) =>
          normalizeTotalsDocument(await target.findOne(translateTotalsFilter(filter), {
            ...options,
            projection: translateTotalsProjection(options.projection),
            sort: translateTotalsSort(options.sort),
          }));
      }
      if (property === "countDocuments") {
        return (filter = {}, options) =>
          target[property](translateTotalsFilter(filter), options);
      }
      if (property === "estimatedDocumentCount") {
        return (options) => target.estimatedDocumentCount(options);
      }
      if (property === "distinct") {
        return (field, filter = {}, options) =>
          target.distinct(
            translateTotalsPath(field),
            translateTotalsFilter(filter),
            options
          );
      }
      if (property === "aggregate") {
        return (pipeline = [], options) =>
          wrapCursor(target.aggregate([legacyAliasStage(), ...pipeline], options));
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapDatabase(db) {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "collection") {
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name, options) => {
        const collection = target.collection(name, options);
        return isTotalsCollection(name) ? wrapTotalsCollection(collection) : collection;
      };
    },
  });
}

module.exports = {
  wrapCursor,
  wrapTotalsCollection,
  wrapDatabase,
};
