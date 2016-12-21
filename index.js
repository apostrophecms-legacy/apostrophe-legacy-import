var mongodb = require('mongodb');
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
    
    self.mapType = function(oldName, newNameOrFn) {
      self.typeMap[oldName] = newNameOrFn;
    };

    self.mapWidget = function(oldName, newNameOrFn) {
      self.widgetMap[oldName] = newNameOrFn;
    };

    self.importTask = function(apos, argv, callback) {
      return async.series([
        self.connectLegacyDb,
        self.importFiles,
        self.importDocs
      ], callback);
    };

    self.connectLegacyDb = function(callback) {
      var legacyDbUriOrName = self.apos.argv['legacy-db'];
      var legacyFiles = self.apos.argv['legacy-root'];
      if (legacyDbUriOrName.match(/mongodb:/)) {
        legacyDbUri = legacyDbUriOrName;
      } else {
        legacyDbUri = 'mongodb://localhost:27017/' + legacyDbUriOrName;
      }
      return mongodb.connect(legacyDbUri, function(err, db) {
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
      return self.apos.migrations.each(self.legacyFiles, {}, 1, self.importFile, callback);
    };
    
    self.importFile = function(file, callback) {
      var attachment;
      return async.series([
        copyFiles,
        insertAttachment,
        insertDoc
      ], callback);
      function copyFiles(callback) {
        var files = glob.sync(self.apos.argv['legacy-root'] + '/public/uploads/files/' + file._id + '-*');
        var n = 0;
        return async.eachSeries(files, function(file, callback) {
          var newFile = 'a205file' + require('path').basename(file);
          var legacyFile = self.apos.argv['legacy-root'] + '/public/uploads/files/' + require('path').basename(file);
          var newFile = self.apos.rootDir + '/public/uploads/attachments/' + newFile;
          // Common for the file to exist with trial and error importing
          if (fs.existsSync(newFile)) {
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
      console.log('importDocs');
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
          newDoc.slug += Math.floor(Math.random() * 10);
          return uniqueSlug(callback);
        });
      }
    }
      
    self.beforeImportDoc = function(doc, newDoc, callback) {
      return callback(null);
    }

    self.afterImportDoc = function(doc, newDoc, callback) {
      return callback(null);
    }
    
    self.importItems = function(items) {
      var newItems = [];
      _.each(items, function(item) {
        if (!self.widgetMap[item.type]) {
          return;
        }
        var widget;
        if (typeof(self.widgetMap[item.type]) === 'string') {
          widget = _.clone(item);
          widget.type = self.widgetMap[item.type];
          widget._id = cuid();
        } else {
          widget = self.widgetMap[item.type](item);
        }
        if (!widget) {
          return;
        }
        newItems.push(widget);
      });
      return newItems;
    };

    self.mapStandardWidgets = function() {
      self.mapWidget('richText', 'apostrophe-rich-text');
      self.mapWidget('slideshow', function(item) {
        var relationships = {};
        _.each(item.extras || {}, function(val, key) {
          var newKey = 'a205file' + key;
          relationships[newKey] = val;
        });
        var widget = {
          _id: cuid(),
          type: 'apostrophe-images',
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
      if (self.apos.argv['map-types']) {
        var pairs = self.apos.argv['map-types'].split(',');
        _.each(pairs, function(pair) {
          pair = pair.split(':');
          self.mapType(pair[0], pair[1]);
        });
      }
      if (self.apos.argv['map-widgets']) {
        var pairs = self.apos.argv['map-widgets'].split(',');
        _.each(pairs, function(pair) {
          pair = pair.split(':');
          self.mapType(pair[0], pair[1]);
        });
      }
    };

    self.copyFile = function(from, to, callback) {
      return fs.copy(from, to, callback);
    };
  }
};
