var mongodb = require('emulate-mongo-2-driver');
var _ = require('lodash');
var async = require('async');
var cuid = require('cuid');
var glob = require('glob');
var fs = require('fs-extra');
var moment = require('moment');

module.exports = {

  afterConstruct: function(self) {
    self.mapStandardWidgets();
    self.mapCommandLine();
    self.apos.tasks.add(self.__meta.name, 'import', self.importTask);
  },

  construct: function(self, options) {

    self.widgetMap = {};
    self.typeMap = {};
    self.blockMap = {};
    self.lockupMap = {};
    
    self.mapType = function(oldName, newNameOrFn) {
      self.typeMap[oldName] = newNameOrFn;
    };

    self.mapWidget = function(oldName, newNameOrFn) {
      self.widgetMap[oldName] = newNameOrFn;
    };

    self.mapBlock = function(oldName, newNameOrFn) {
      self.blockMap[oldName] = newNameOrFn;
    };

    self.mapLockup = function(oldName, newNameOrFn) {
      self.lockupMap[oldName] = newNameOrFn;
    };

    self.importTask = function(apos, argv, callback) {
      return async.series([
        self.connectLegacyDb,
        self.importFiles,
        self.importDocs
      ], callback);
    };

    self.connectLegacyDb = function(callback) {
      console.log('Connecting to legacy db');
      var legacyDbUriOrName = self.apos.argv['legacy-db'];
      var legacyFiles = self.apos.argv['legacy-root'];
      if (legacyDbUriOrName.match(/mongodb:/)) {
        legacyDbUri = legacyDbUriOrName;
      } else {
        legacyDbUri = 'mongodb://localhost:27017/' + legacyDbUriOrName;
      }
      return mongodb.MongoClient.connect(legacyDbUri, function(err, db) {
        if (err) {
          return callback(err);
        }
        self.legacyDb = db;
        self.legacyPages = self.legacyDb.collection('aposPages');
        self.legacyFiles = self.legacyDb.collection('aposFiles');
        return callback(null);
      });
    };
    
    self.importFiles = function(callback) {
      console.log('Importing files');
      self.oldFilesDir = self.apos.argv['legacy-root'] + '/public/uploads/files/';
      self.newFilesDir = self.apos.rootDir + '/public/uploads/attachments/';
      const existingOld = fs.readdirSync(self.oldFilesDir).map(file => self.oldFilesDir + file);
      const existingNew = fs.readdirSync(self.newFilesDir).map(file => self.newFilesDir + file);
      return self.apos.migrations.each(self.legacyFiles, {}, 1, function(file, callback) {
        return self.importFile(file, existingOld, existingNew, callback);
      }, callback);
    };
    
    self.importFile = function(file, existingOld, existingNew, callback) {
      var attachment;
      return async.series([
        copyFiles,
        insertAttachment,
        insertDoc
      ], callback);
      function copyFiles(callback) {
        var files = existingOld.filter(name => name.startsWith(self.oldFilesDir + file._id));
        var n = 0;
        return async.eachSeries(files, function(file, callback) {
          var newFile = 'a205file' + require('path').basename(file);
          var legacyFile = self.apos.argv['legacy-root'] + '/public/uploads/files/' + require('path').basename(file);
          var newFile = self.newFilesDir + newFile;
          if (existingNew.find(name => name === newFile)) {
            return setImmediate(callback);
          }
          return self.copyFile(legacyFile, newFile, callback);
        }, callback);
      }
      function insertAttachment(callback) {
        attachment = _.clone(file);
        _.extend(attachment, {
          _id: 'a205file' + file._id,
          type: 'attachment'
        });
        // Can lead to infinite recursion
        delete attachment._owner;
        return self.apos.attachments.db.insert(attachment, callback);
      }
      function insertDoc(callback) {
        var newDoc = {};
        _.extend(newDoc, {
          _id: 'a205file' + file._id,
          slug: 'a205file' + file._id + '-' + file.name,
          type: (file.group === 'office') ? 'apostrophe-file' : 'apostrophe-image',
          title: file.title,
          published: true,
          attachment: attachment
        });
        return self.apos.docs.db.insert(newDoc, callback);
      }
    };
    
    self.importDocs = function(callback) {
      console.log('Importing documents');
      var cursor = self.legacyPages.find({}).sort({ level: 1, path: 1, rank: 1, slug: 1 });
      one();
      // async while loop through all the legacy docs with the custom sort
      function one() {
        cursor.nextObject(function(err, doc) {
          if (err) {
            return callback(err);
          }
          if (!doc) {
            return callback(null);
          }
          return self.importDoc(doc, function(err) {
            if (err) {
              return callback(err);
            }
            one();
          });
        });
      }
    };

    self.importDoc = function(doc, callback) {
      if (!self.typeMap[doc.type]) {
        return setImmediate(callback);
      }
      var newDoc = {};
      if (doc.blockGroups) {
        self.importBlocks(doc);
      }
      _.each(doc, function(val, key) {
        if (val && (val.type === 'area')) {
          newDoc[key] = {
            type: 'area',
            items: self.importItems(val.items || [])
          };
        } else if (key === 'path') {
          newDoc.path = val.replace(/^home/, '');
        } else if (key === 'type') {
          // typeMap handles this
        } else if (key === 'sortTitle') {
          newDoc.titleSortified = val;
        } else {
          newDoc[key] = val;
        }
      });

      if (typeof(self.typeMap[doc.type]) === 'string') {
        newDoc.type = self.typeMap[doc.type];
      } else {
        newDoc = self.typeMap[doc.type](doc, newDoc);
      }
      
      if (doc.publishedAt && (doc.type.match(/blog/i) || newDoc.type.match(/blog/i))) {
        // This is flat wrong, but for now the 2.0 blog module has
        // just date in publishedAt and not a Date object ):
        newDoc.publishedAt = moment(doc.publishedAt).format('YYYY-MM-DD');
      }

      if (self.apos.argv['blog-2']) {
        if (doc.type === 'blogPost') {
          doc.slug = doc.slug.replace(/^(.*\/)/, '');
        }
      }

      return async.series([
        uniqueSlug,
        _.partial(self.beforeImportDoc, doc, newDoc),
        function(callback) {
          self.apos.docs.db.insert(newDoc, callback);
        },
        _.partial(self.afterImportDoc, doc, newDoc)
      ], function(err) {
        if (err === 'skip') {
          return callback(null);
        }
        return callback(err);
      });
      
      // A duplicate slug is possible if your 2.0 site already has it.
      // Make it unique enough
      function uniqueSlug(callback) {
        return self.apos.docs.db.findOne({slug: newDoc.slug }, function(err, match) {
          if (err) {
            return callback(err);
          }
          if (!match) {
            return callback(null);
          }
          if (match.parked) {
            if (self.apos.argv['replace-parked']) {
              return self.apos.docs.db.removeOne({
                slug: newDoc.slug
              }, callback);
            }
          }
          newDoc.slug += Math.floor(Math.random() * 10);
          return uniqueSlug(callback);
        });
      }
    }

    self.importBlocks = function(doc) {
      if (!doc.blockGroups) {
        return;
      }
      for (const [name, info] of Object.entries(doc.blockGroups)) {
        doc[name] = {
          _id: cuid(),
          type: 'area',
          items: []
        };
        for (const block of info.blocks) {
          if (!self.blockMap[block.type]) {
            continue;
          }
          const blockWidget = {
            type: self.blockMap[block.type]
          };
          const prefix = `${name}_${block.id}_`;
          const relevant = Object.keys(doc).filter(key => key.substring(0, prefix.length) === prefix);
          const areaNames = [ ...new Set(relevant.map(key => key.replace(prefix, ''))) ];
          for (const areaName of areaNames) {
            const area05Name = prefix + areaName;
            blockWidget[areaName] = {
              type: 'area',
              // Don't import them yet, we'll recursively import all in the doc later
              items: doc[area05Name].items
            };
            doc[name].items.push(blockWidget);
          }
          for (const key of relevant) {
            // Don't double-import
            delete doc[key];
          }
        }
        const orphans = Object.keys(doc).filter(key => key.startsWith(`${name}_`));
        orphans.forEach(orphan => delete doc[orphan]);
      }
      delete doc.blockGroups;
    };
      
    self.beforeImportDoc = function(doc, newDoc, callback) {
      return callback(null);
    }

    self.afterImportDoc = function(doc, newDoc, callback) {
      return callback(null);
    }
    
    self.importItems = function(items) {
      var newItems = [];
      for (let i = 0; (i < items.length); i++) {
        const item = items[i];
        if (item._id && item._id.toString().startsWith('a205widget')) {
          // Already converted, some recursive gotcha
          newItems.push(item);
          continue;
        }
        if (item.lockup && self.lockupMap[item.lockup]) {
          const lockup = self.importLockup(item.lockup, item, items[i + 1]);
          if (lockup) {
            newItems.push(lockup);
            i++;
            continue;
          }
        }
        if (!self.widgetMap[item.type]) {
          continue;
        }
        let widget;
        if (typeof(self.widgetMap[item.type]) === 'string') {
          widget = _.clone(item);
          widget.type = self.widgetMap[item.type];
          widget._id = item.id ? `a205widget${item.id}` : `a205widget${cuid()}`;
        } else {
          widget = self.widgetMap[item.type](item);
        }
        recursivelyImportAreas(widget);
        if (!widget) {
          continue;
        }
        newItems.push(widget);
      }
      return newItems;

      function recursivelyImportAreas(widget) {
        for (const [key, val] of Object.entries(widget)) {
          if (val && (val.type === 'area')) {
            val.items = self.importItems(val.items);
          }
          if (val && (typeof val === 'object')) {
            recursivelyImportAreas(val);
          }
        }
      }
    };

    self.importLockup = function(name, richText, other) {
      if (!(richText && other)) {
        return false;
      }
      return {
        type: self.lockupMap[name],
        richText: {
          type: 'area',
          items: self.importItems([ _.omit(richText, 'lockup') ])
        },
        media: {
          type: 'area',
          items: self.importItems([ other ])
        }
      }
    };

    self.mapStandardWidgets = function() {
      self.mapWidget('richText', 'apostrophe-rich-text');
      self.mapWidget('html', 'apostrophe-html');
      self.mapWidget('slideshow', function(item) {
        var relationships = {};
        _.each(item.extras || {}, function(val, key) {
          var newKey = 'a205file' + key;
          relationships[newKey] = val;
        });
        var widget = {
          originalId: item.id,
          _id: `a205widget${item.id}`,
          type: self.apos.argv['slideshow-type'] || 'apostrophe-images',
          by: 'id',
          pieceIds: _.map(item.ids || [], function(id) {
            return 'a205file' + id
          }),
          relationships: relationships
        };
        return widget;
      });
      self.mapWidget('video', function(item) {
        return {
          type: 'apostrophe-video',
          video: {
            url: item.video,
            title: item.title,
            thumbnail: item.thumbnail
          }
        };
      });
    };
    
    self.mapCommandLine = function() {
      [ 'type', 'widget', 'block', 'lockup' ].forEach(feature => {
        const option = `map-${feature}s`;
        if (self.apos.argv[option]) {
          const pairs = self.apos.argv[option].split(',');
          _.each(pairs, function(pair) {
            pair = pair.split(':');
            self[`${feature}Map`][pair[0]] = pair[1];
          });
        }
      });
      Object.values(self.blockMap).forEach(name => self.widgetMap[name] = name);
      Object.values(self.lockupMap).forEach(name => self.widgetMap[name] = name);
    };

    self.copyFile = function(from, to, callback) {
      return fs.copy(from, to, callback);
    };
  }
};
