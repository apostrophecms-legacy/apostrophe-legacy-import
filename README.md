## Purpose

Migrates content from [Apostrophe](http://apostrophecms.org) 0.5 projects to Apostrophe 2.x.

## Stability

Beta. Used successfully to import blogs (although not blog-2 style blogs). Should work for pages too but this has not yet been tested.

## Usage

```
node app apostrophe-legacy-import:import \
  --map-types=blogPost:apostrophe-blog \
  --map-widgets=oldName:new-name \
  --map-lockups=left:block-left \
  --map-blocks=oneColumn:one-column,twoColumn:two-column \
  --legacy-db=punkave05 \
  --legacy-root=/Users/boutell/node-sites/punkave05 &&
node app apostrophe-attachments:rescale --parallel=4
```

You must configure the `apostrophe-legacy-import` module in `app.js` (no options are currently required).

If you already have a 2.x site with content, importing a piece type like `apostrophe-blog` like this should not unduly impact the rest of your site, however there is no guarantee of this. Always back up.

The use of `--map-types` is required. You must map at least one 0.5 page or snippet type to a 2.x doc type. **No doc types not mapped will be imported. Separate the pairs with commas.**

There is also a `--map-widgets` option which works the same way. There are some default mappings for common widgets (`slideshow` -> `apostrophe-images`, `video` -> `apostrophe-video`).

If you wish to map `slideshow` to something other than `apostrophe-images` but keep the logic that migrates its content in a format suitable for a pieces widget in 2.x, use `--slideshow-type=x` to specify the widget type name for it, rather than including it in `--map-widgets`.

`--map-lockups` maps 0.5 lockups to nested widgets in your 2.x site, which must exist and be designed to contain two child areas, a rich text singleton named `richText` and an area named `media` which should have `limit: 1` and allow the same widgets that were configured for the lockup.

`--map-blocks` maps 0.5 blocks to nested widgets in your 2.x site, which must exist and be designed to contain areas accepting the same widgets that the 0.5 blocks did. If the old block template contained areas named with `prefix + 'one'` and `prefix + 'two'`, then the new nested widget should contain sub-areas named `'one'` and `'two'`.

`--blog-2` can be passed to drop the path portion of the slug from all docs of type `blogPost`. This is necessary when importing content from `apostrophe-blog-2`.

> **Warning:** `apostrophe-blog-2` has no direct equivalent in Apostrophe 2. Currently it only makes sense to use this option when there was just one parent blog page on the 0.5 site. If there was more than one, you will be left with no way to distinguish the blogs the posts belong to. Contributions welcome.

## Importing the home page and other parked pages

Normally this task will only add new documents, and if there are slug conflicts, it will change the slug of the imported document. So if you are attempting to import an entire site, your home page will still be blank, because the "parked" homepage of the A2 site will already be there.

You can override this with the `--replace-parked` option. This option will delete any parked pages that are in conflict with newly imported pages, allowing the imported pages to replace them.

## After migration

All of the files on the old site are imported to the image and file libraries as appropriate.

You need to run the rescale task to be sure you have versions of the images at each size used on the new site. This takes time. `--parallel=4` is faster but requires RAM your server might not have, so it's up to you whether to use it.

## Customization

See the `beforeImportDoc` and `afterImportDoc` methods which are initially empty for your project level override convenience.

You can also provide functions to remap various widgets in a customized way. See the source code.

Back things up. Test things. There is no warranty, express or implied.
