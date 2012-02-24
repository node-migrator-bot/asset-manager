var fs    = require('fs'),
    path  = require('path'),
    utils = require('./utils');

function Asset(route, ext, type, context, servePath) {
  if(route) {
    this.requested = route;
    this.actual = route;
    this.ext = ext;
    this.file = route.substr(route.lastIndexOf("/") + 1);
    this.name = this.file.replace("." + this.ext, "");
    this.pathPart = this.file.replace(this.file, "");
    this.type = type;
    this.isAbsolute = route.indexOf("http") === 0 ? true : false;
    this.context = context;
    this.servePath = servePath || '';
    
    this.diskPath = '';
    this.fingerprint = null;
  }
}
var aproto = Asset.prototype;

aproto.toHTML = function toHTML() {
  return this.getRequestPath();
};

aproto.getRelativePath = function getRelativePath() {
  return path.join(this.type, this.actual);
};

aproto.getRequestPath = function getRequestPath() {
  return this.servePath + path.join("/", this.type, this.actual);
};

aproto.setDiskPath = function setDiskPath(diskPath, computeFingerprint) {
  this.diskPath = diskPath;
  
  if(computeFingerprint) {
    this.readContents();
    this.setFingerprint(utils.generateHash(this.content));
  }
};

aproto.setFingerprint = function setFingerprint(fingerprint) {
  this.fingerprint = fingerprint;
  this.actual = path.join(this.pathPart, (this.name + "-" + this.fingerprint + "." + this.ext));
};

aproto.readContents = function readContents() {
  this.content = fs.readFileSync(this.diskPath);
  return this.content;
};
aproto.getServerManifestEntry = function getServerManifestEntry() {
  var entry = {
    requested: this.requested,
    type: this.type,
    output: this.toHTML(),
    relativePath: this.getRelativePath(),
    fingerprint: this.fingerprint
  };
  
  return entry;
};
aproto.getClientManifestEntry = function getServerManifestEntry() {
  var entry = {
    name: this.name,
    path: this.getRequestPath()
  };
  return entry;
};
aproto.writeContents = function writeContents(basePath) {
  var finalPath = path.join(basePath, this.getRelativePath());
  utils.mkdirRecursiveSync(path.dirname(finalPath), 0755);
  fs.writeFile(finalPath, this.content);
}


/**
 * IMGAsset Object definition
 */
function IMGAsset(route, ext, context, servePath) {
  Asset.call(this, route, ext, 'img', context, servePath);
}
IMGAsset.prototype = new Asset;


/**
 * JSAsset Object definition
 */
function JSAsset(route, context, servePath) {
  Asset.call(this, route, 'js', 'js', context, servePath);
}
var jproto = JSAsset.prototype = new Asset;

jproto.readContents = function readContents() {
  this.contentRaw = (aproto.readContents.call(this)).toString('utf8');
  this.content = utils.compressJS(this.contentRaw);
  return this.content;
};

jproto.toHTML = function toHTML() {
  return "<script src='" + this.getRequestPath() + "'></script>";
};

jproto.toHTMLRaw = function toHTMLRaw() {
  return "<script src='" + this.getRequestRawPath() + "'></script>";
};

jproto.getRelativeRawPath = function getRelativeRawPath() {
  var fileName = this.name + (this.fingerprint ? "-" + this.fingerprint : "") + "_raw." + this.ext;
  return path.join(this.type, this.pathPart, fileName);
};

jproto.getRequestRawPath = function getRequestRawPath() {
  var fileName = this.name + (this.fingerprint ? "-" + this.fingerprint : "") + "_raw." + this.ext;
  return this.servePath + path.join("/", this.type, this.pathPart, fileName);
};

jproto.getServerManifestEntry = function getServerManifestEntry() {
  var entry = aproto.getServerManifestEntry.call(this);
  entry.outputRaw = this.toHTMLRaw();
  return entry;
};

jproto.writeContents = function writeContents(basePath) {
  aproto.writeContents.call(this, basePath);
  fs.writeFile(path.join(basePath, this.getRelativeRawPath()), this.contentRaw);
}


/**
 * CSSAsset Object definition
 */
function CSSAsset(route, context, servePath) {
  route = this.extractMediaType(route);
  Asset.call(this, route, 'css', 'css', context, servePath);
}
var cproto = CSSAsset.prototype = new Asset;

cproto.toHTML = function toHTML() {
  return "<link href='" + this.getRequestPath() + "' rel='stylesheet' media='" + this.mediaType + "'>";
};

cproto.readContents = function readContents() {
  this.content = (aproto.readContents.call(this)).toString('utf8');
  
  var actual = this.actual;
  function resolveImgPath(path){
    var resolvedPath = path + "";
    resolvedPath = resolvedPath.replace(/url\(|'|"|\)/g, '');
    try {
      resolvedPath = img(resolvedPath);
    }
    catch(e) {
      console.error("Can't resolve image path '" + resolvedPath + "' in '" + actual + "'");
    }
    if(resolvedPath[0] != '/' && resolvedPath.indexOf('http') !== 0) {
      resolvedPath = '/' + resolvedPath;
    }
    return "url('" + resolvedPath + "')";
  }
  
  //fix the img paths int he css file
  var regex = /url\([^\)]+\)/g
  this.content = this.content.replace(regex, resolveImgPath);
  
  return this.content;
};

/**
 * CSS files can be include by passing a string that is the path to the css file OR an object which contains a key that 
 * is the media type of the css file and the value is the path to the css file.  This function takes the css 'route' and 
 * returns an object with a media type and a path.
 */
cproto.extractMediaType = function extractMediaType(route){
  this.mediaType = 'all';

  if(typeof route !== 'string') {
    for(var key in route) {
      this.mediaType = key;
      route = route[key];
    }
  }
  
  return route;
}

/**
 * Declare exports
 */
exports.parse = function parse(route, context, servePath) {
  var ext = typeof route !== 'string' ? 'css' : route.substr(route.lastIndexOf(".") + 1);
  
  switch(ext) {
    case "js":
      return new JSAsset(route, context, servePath);
      break;
    case "css":
      return new CSSAsset(route, context, servePath);
    default:
      return new IMGAsset(route, ext, context, servePath);
  }
}

/**
 * Given an absolute path on the filesystem, extract the piece that is the relative path
 * and create an `Asset` for that file.  This function is here to support the precompile
 * function of the asset-manager.
 */
exports.parseDiskPath = function parseDiskPath(diskPath, context, paths, servePath) {
  var asset = null;
  
  for(var i=0; i<paths.length; ++i) {
    var aPath = paths[i];
    if(diskPath.indexOf(aPath) === 0) {
      var route = diskPath.replace(aPath + '/', '');
      route = route.substr(route.indexOf('/') + 1);
      asset = exports.parse(route, context, servePath);
      asset.setDiskPath(diskPath, true);
      break;
    }
  }
  
  if(asset === null) {
    console.log("Unable to find asset: " + diskPath);
  }
  
  return asset;
}