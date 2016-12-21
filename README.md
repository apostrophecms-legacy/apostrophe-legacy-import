## Purpose

Migrates content from [Apostrophe](http://apostrophecms.org) 0.5 projects to Apostrophe 2.x.

## Stability

Beta. Used successfully to import blogs (although not blog-2 style blogs). Should work for pages too but this has not yet been tested.

## Usage

```
node app apostrophe-legacy-import:import \
  --map-types=blogPost:apostrophe-blog \
  --legacy-db=punkave05 \
  --legacy-root=/Users/boutell/node-sites/punkave05 &&
node app apostrophe-attachments:rescale --parallel=4
```

You must configure the `apostrophe-legacy-import` module in `app.js` (no options are currently required).

The use of `--map-types` is required. You must map at least one 0.5 page or snippet type to a 2.x doc type. **No doc types not mapped will be imported.**

There is also a `--map-widgets` option which works the same way. There are some default mappings for common widgets.

Importing a piece type like `apostrophe-blog` like this should not unduly impact the rest of your site.

All of the files on the old site are imported to the image and file libraries as appropriate.

You need to run the rescale task to be sure you have versions of the images at each size used on the new site. This takes time. `--parallel=4` is faster but requires RAM your server might not have, so it's up to you whether to use it.

## Customization

See the `beforeImportDoc` and `afterImportDoc` methods which are initially empty for your project level override convenience.

You can also provide functions to remap various widgets in a customized way. See the source code.

Back things up. Test things. There is no warranty, express or implied.
