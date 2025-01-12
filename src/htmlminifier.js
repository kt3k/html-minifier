(function(global) {
  'use strict';

  var log, HTMLParser;
  if (global.console && global.console.log) {
    log = function(message) {
      // "preserving" `this`
      global.console.log(message);
    };
  }
  else {
    log = function() {};
  }

  if (global.HTMLParser) {
    HTMLParser = global.HTMLParser;
  }
  else if (typeof require === 'function') {
    HTMLParser = require('./htmlparser').HTMLParser;
  }

  var trimWhitespace = function(str) {
    if (typeof str !== 'string') {
      return str;
    }
    return str.replace(/^\s+/, '').replace(/\s+$/, '');
  };
  if (String.prototype.trim) {
    trimWhitespace = function(str) {
      if (typeof str !== 'string') {
        return str;
      }
      return str.trim();
    };
  }

  function collapseWhitespaceAll(str) {
    return str ? str.replace(/[\t\n\r ]+/g, ' ') : str;
  }

  function createMap(values) {
    var map = {};
    values.forEach(function(value) {
      map[value] = 1;
    });
    return function(value) {
      return map[value] === 1;
    };
  }

  function createMapFromString(values) {
    return createMap(values.split(/,/));
  }

  function collapseWhitespace(str, options, trimLeft, trimRight, collapseAll) {
    var lineBreakBefore = '', lineBreakAfter = '';

    if (options.preserveLineBreaks) {
      str = str.replace(/^[\t ]*[\n\r][\t\n\r ]*/, function() {
        lineBreakBefore = '\n';
        return '';
      }).replace(/[\t\n\r ]*[\n\r][\t ]*$/, function() {
        lineBreakAfter = '\n';
        return '';
      });
    }

    if (trimLeft) {
      str = str.replace(/^\s+/, !lineBreakBefore && options.conservativeCollapse ? ' ' : '');
    }

    if (trimRight) {
      str = str.replace(/\s+$/, !lineBreakAfter && options.conservativeCollapse ? ' ' : '');
    }

    if (collapseAll) {
      // strip non space whitespace then compress spaces to one
      str = collapseWhitespaceAll(str);
    }

    return lineBreakBefore + str + lineBreakAfter;
  }

  // non-empty tags that will maintain whitespace around them
  var inlineTags = createMapFromString('a,abbr,acronym,b,bdi,bdo,big,button,cite,code,del,dfn,em,font,i,ins,kbd,mark,math,q,rt,rp,s,samp,small,span,strike,strong,sub,sup,svg,time,tt,u,var');
  // non-empty tags that will maintain whitespace within them
  var inlineTextTags = createMapFromString('a,abbr,acronym,b,big,del,em,font,i,ins,kbd,mark,s,samp,small,span,strike,strong,sub,sup,time,tt,u,var');
  // self-closing tags that will maintain whitespace around them
  var selfClosingInlineTags = createMapFromString('comment,img,input');

  function collapseWhitespaceSmart(str, prevTag, nextTag, options) {
    var trimLeft = prevTag && !selfClosingInlineTags(prevTag);
    if (trimLeft && !options.collapseInlineTagWhitespace) {
      trimLeft = prevTag.charAt(0) === '/' ? !inlineTags(prevTag.slice(1)) : !inlineTextTags(prevTag);
    }
    var trimRight = nextTag && !selfClosingInlineTags(nextTag);
    if (trimRight && !options.collapseInlineTagWhitespace) {
      trimRight = nextTag.charAt(0) === '/' ? !inlineTextTags(nextTag.slice(1)) : !inlineTags(nextTag);
    }
    return collapseWhitespace(str, options, trimLeft, trimRight, prevTag && nextTag);
  }

  function isConditionalComment(text) {
    return /^\[if\s[^\]]+\]|\[endif\]$/.test(text);
  }

  function isIgnoredComment(text, options) {
    if (/^!/.test(text)) {
      return true;
    }

    if (options.ignoreCustomComments) {
      for (var i = 0, len = options.ignoreCustomComments.length; i < len; i++) {
        if (options.ignoreCustomComments[i].test(text)) {
          return true;
        }
      }
    }

    return false;
  }

  function isEventAttribute(attrName, options) {
    var patterns = options.customEventAttributes;
    if (patterns) {
      for (var i = patterns.length; i--;) {
        if (patterns[i].test(attrName)) {
          return true;
        }
      }
      return false;
    }
    else {
      return (/^on[a-z]{3,}$/).test(attrName);
    }
  }

  function canRemoveAttributeQuotes(value) {
    // http://mathiasbynens.be/notes/unquoted-attribute-values
    return (/^[^\x20\t\n\f\r"'`=<>]+$/).test(value);
  }

  function attributesInclude(attributes, attribute) {
    for (var i = attributes.length; i--;) {
      if (attributes[i].name.toLowerCase() === attribute) {
        return true;
      }
    }
    return false;
  }

  function isAttributeRedundant(tag, attrName, attrValue, attrs) {
    attrValue = attrValue ? trimWhitespace(attrValue.toLowerCase()) : '';

    return (
        (tag === 'script' &&
        attrName === 'language' &&
        attrValue === 'javascript') ||

        (tag === 'form' &&
        attrName === 'method' &&
        attrValue === 'get') ||

        (tag === 'input' &&
        attrName === 'type' &&
        attrValue === 'text') ||

        (tag === 'script' &&
        attrName === 'charset' &&
        !attributesInclude(attrs, 'src')) ||

        (tag === 'a' &&
        attrName === 'name' &&
        attributesInclude(attrs, 'id')) ||

        (tag === 'area' &&
        attrName === 'shape' &&
        attrValue === 'rect')
    );
  }

  // https://mathiasbynens.be/demo/javascript-mime-type
  // https://developer.mozilla.org/en/docs/Web/HTML/Element/script#attr-type
  var executableScriptsMimetypes = createMap([
    'text/javascript',
    'text/ecmascript',
    'text/jscript',
    'application/javascript',
    'application/x-javascript',
    'application/ecmascript'
  ]);

  function isScriptTypeAttribute(tag, attrName, attrValue) {
    return (
      tag === 'script' &&
      attrName === 'type' &&
      executableScriptsMimetypes(trimWhitespace(attrValue.toLowerCase()))
    );
  }

  function isExecutableScript(tag, attrs) {
    if (tag !== 'script') {
      return false;
    }
    for (var i = 0, len = attrs.length; i < len; i++) {
      var attrName = attrs[i].name.toLowerCase();
      if (attrName === 'type') {
        var attrValue = trimWhitespace(attrs[i].value.split(/;/, 2)[0]).toLowerCase();
        return attrValue === '' || executableScriptsMimetypes(attrValue);
      }
    }
    return true;
  }

  function isStyleLinkTypeAttribute(tag, attrName, attrValue) {
    return (
      (tag === 'style' || tag === 'link') &&
      attrName === 'type' &&
      trimWhitespace(attrValue.toLowerCase()) === 'text/css'
    );
  }

  var isSimpleBoolean = createMapFromString('allowfullscreen,async,autofocus,autoplay,checked,compact,controls,declare,default,defaultchecked,defaultmuted,defaultselected,defer,disabled,enabled,formnovalidate,hidden,indeterminate,inert,ismap,itemscope,loop,multiple,muted,nohref,noresize,noshade,novalidate,nowrap,open,pauseonexit,readonly,required,reversed,scoped,seamless,selected,sortable,truespeed,typemustmatch,visible');
  var isBooleanValue = createMapFromString('true,false');

  function isBooleanAttribute(attrName, attrValue) {
    return isSimpleBoolean(attrName) || attrName === 'draggable' && !isBooleanValue(attrValue);
  }

  function isUriTypeAttribute(attrName, tag) {
    return (
      ((/^(?:a|area|link|base)$/).test(tag) && attrName === 'href') ||
      (tag === 'img' && (/^(?:src|longdesc|usemap)$/).test(attrName)) ||
      (tag === 'object' && (/^(?:classid|codebase|data|usemap)$/).test(attrName)) ||
      (tag === 'q' && attrName === 'cite') ||
      (tag === 'blockquote' && attrName === 'cite') ||
      ((tag === 'ins' || tag === 'del') && attrName === 'cite') ||
      (tag === 'form' && attrName === 'action') ||
      (tag === 'input' && (attrName === 'src' || attrName === 'usemap')) ||
      (tag === 'head' && attrName === 'profile') ||
      (tag === 'script' && (attrName === 'src' || attrName === 'for'))
    );
  }

  function isNumberTypeAttribute(attrName, tag) {
    return (
      ((/^(?:a|area|object|button)$/).test(tag) && attrName === 'tabindex') ||
      (tag === 'input' && (attrName === 'maxlength' || attrName === 'tabindex')) ||
      (tag === 'select' && (attrName === 'size' || attrName === 'tabindex')) ||
      (tag === 'textarea' && (/^(?:rows|cols|tabindex)$/).test(attrName)) ||
      (tag === 'colgroup' && attrName === 'span') ||
      (tag === 'col' && attrName === 'span') ||
      ((tag === 'th' || tag === 'td') && (attrName === 'rowspan' || attrName === 'colspan'))
    );
  }

  function isCanonicalURL(tag, attrs) {
    if (tag !== 'link') {
      return false;
    }
    for (var i = 0, len = attrs.length; i < len; i++) {
      if (attrs[i].name === 'rel' && attrs[i].value === 'canonical') {
        return true;
      }
    }
  }

  var fnPrefix = '!function(){';
  var fnSuffix = '}();';

  function cleanAttributeValue(tag, attrName, attrValue, options, attrs) {
    if (attrValue && isEventAttribute(attrName, options)) {
      attrValue = trimWhitespace(attrValue).replace(/^javascript:\s*/i, '').replace(/\s*;$/, '');
      if (options.minifyJS) {
        var minified = minifyJS(fnPrefix + attrValue + fnSuffix, options.minifyJS);
        return minified.slice(fnPrefix.length, -fnSuffix.length);
      }
      return attrValue;
    }
    else if (attrName === 'class') {
      return collapseWhitespaceAll(trimWhitespace(attrValue));
    }
    else if (isUriTypeAttribute(attrName, tag)) {
      attrValue = trimWhitespace(attrValue);
      if (options.minifyURLs && !isCanonicalURL(tag, attrs)) {
        return minifyURLs(attrValue, options.minifyURLs);
      }
      return attrValue;
    }
    else if (isNumberTypeAttribute(attrName, tag)) {
      return trimWhitespace(attrValue);
    }
    else if (attrName === 'style') {
      attrValue = trimWhitespace(attrValue);
      if (attrValue) {
        attrValue = attrValue.replace(/\s*;\s*$/, '');
      }
      if (options.minifyCSS) {
        return minifyCSS(attrValue, options.minifyCSS, true);
      }
      return attrValue;
    }
    else if (isMetaViewport(tag, attrs) && attrName === 'content') {
      attrValue = attrValue.replace(/\s+/g, '').replace(/[0-9]+\.[0-9]+/g, function(numString) {
        // "0.90000" -> "0.9"
        // "1.0" -> "1"
        // "1.0001" -> "1.0001" (unchanged)
        return (+numString).toString();
      });
    }
    else if (attrValue && options.customAttrCollapse && options.customAttrCollapse.test(attrName)) {
      attrValue = attrValue.replace(/\n+|\r+|\s{2,}/g, '');
    }
    else if (tag === 'script' && attrName === 'type') {
      attrValue = trimWhitespace(attrValue.replace(/\s*;\s*/g, ';'));
    }
    return attrValue;
  }

  function isMetaViewport(tag, attrs) {
    if (tag !== 'meta') {
      return false;
    }
    for (var i = 0, len = attrs.length; i < len; i++) {
      if (attrs[i].name === 'name' && attrs[i].value === 'viewport') {
        return true;
      }
    }
  }

  // Wrap CSS declarations for CleanCSS > 3.x
  // See https://github.com/jakubpawlowicz/clean-css/issues/418
  function wrapCSS(text) {
    return '*{' + text + '}';
  }

  function unwrapCSS(text) {
    var matches = text.match(/^\*\{([\s\S]*)\}$/m);
    if (matches && matches[1]) {
      return matches[1];
    }
    else {
      return text;
    }
  }

  function cleanConditionalComment(comment, options) {
    return comment.replace(/^(\[if\s[^\]]+\]>)([\s\S]*?)(<!\[endif\])$/, function(match, prefix, text, suffix) {
      return prefix + minify(text, options, true) + suffix;
    });
  }

  function removeCDATASections(text) {
    return text
      // "/* <![CDATA[ */" or "// <![CDATA["
      .replace(/^(?:\s*\/\*\s*<!\[CDATA\[\s*\*\/|\s*\/\/\s*<!\[CDATA\[.*)/, '')
      // "/* ]]> */" or "// ]]>"
      .replace(/(?:\/\*\s*\]\]>\s*\*\/|\/\/\s*\]\]>)\s*$/, '');
  }

  function processScript(text, options, currentAttrs) {
    for (var i = 0, len = currentAttrs.length; i < len; i++) {
      if (currentAttrs[i].name.toLowerCase() === 'type' &&
          options.processScripts.indexOf(currentAttrs[i].value) > -1) {
        return minify(text, options);
      }
    }
    return text;
  }

  var reStartDelimiter = {
    // account for js + html comments (e.g.: //<!--)
    script: /^\s*(?:\/\/)?\s*<!--.*\n?/,
    style: /^\s*<!--\s*/
  };
  var reEndDelimiter = {
    script: /\s*(?:\/\/)?\s*-->\s*$/,
    style: /\s*-->\s*$/
  };
  function removeComments(text, tag) {
    return text.replace(reStartDelimiter[tag], '').replace(reEndDelimiter[tag], '');
  }

  // Tag omission rules from https://html.spec.whatwg.org/multipage/syntax.html#optional-tags
  // with the following deviations:
  // - retain <body> if followed by <noscript>
  // - </rb>, </rt>, </rtc>, </rp> & </tfoot> follow http://www.w3.org/TR/html5/syntax.html#optional-tags
  // - retain all tags which are adjacent to non-standard HTML tags
  var optionalStartTags = createMapFromString('html,head,body,colgroup,tbody');
  var optionalEndTags = createMapFromString('html,head,body,li,dt,dd,p,rb,rt,rtc,rp,optgroup,option,colgroup,caption,thead,tbody,tfoot,tr,td,th');
  var headerTags = createMapFromString('meta,link,script,style,template,noscript');
  var descriptionTags = createMapFromString('dt,dd');
  var pBlockTags = createMapFromString('address,article,aside,blockquote,details,div,dl,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hgroup,hr,main,menu,nav,ol,p,pre,section,table,ul');
  var pInlineTags = createMapFromString('a,audio,del,ins,map,noscript,video');
  var rubyTags = createMapFromString('rb,rt,rtc,rp');
  var rtcTag = createMapFromString('rb,rtc,rp');
  var optionTag = createMapFromString('option,optgroup');
  var tableContentTags = createMapFromString('tbody,tfoot');
  var tableSectionTags = createMapFromString('thead,tbody,tfoot');
  var cellTags = createMapFromString('td,th');
  var topLevelTags = createMapFromString('html,head,body');
  var compactTags = createMapFromString('html,body');
  var looseTags = createMapFromString('head,colgroup,caption');
  var trailingTags = createMapFromString('dt,thead');
  var htmlTags = createMapFromString('a,abbr,acronym,address,applet,area,article,aside,audio,b,base,basefont,bdi,bdo,bgsound,big,blink,blockquote,body,br,button,canvas,caption,center,cite,code,col,colgroup,command,content,data,datalist,dd,del,details,dfn,dialog,dir,div,dl,dt,element,em,embed,fieldset,figcaption,figure,font,footer,form,frame,frameset,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,i,iframe,image,img,input,ins,isindex,kbd,keygen,label,legend,li,link,listing,main,map,mark,marquee,menu,menuitem,meta,meter,multicol,nav,nobr,noembed,noframes,noscript,object,ol,optgroup,option,output,p,param,picture,plaintext,pre,progress,q,rp,rt,rtc,ruby,s,samp,script,section,select,shadow,small,source,spacer,span,strike,strong,style,sub,summary,sup,table,tbody,td,template,textarea,tfoot,th,thead,time,title,tr,track,tt,u,ul,var,video,wbr,xmp');

  function canRemoveParentTag(optionalStartTag, tag) {
    switch (optionalStartTag) {
      case 'html':
      case 'head':
        return true;
      case 'body':
        return !headerTags(tag);
      case 'colgroup':
        return tag === 'col';
      case 'tbody':
        return tag === 'tr';
    }
    return false;
  }

  function isStartTagMandatory(optionalEndTag, tag) {
    switch (tag) {
      case 'colgroup':
        return optionalEndTag === 'colgroup';
      case 'tbody':
        return tableSectionTags(optionalEndTag);
    }
    return false;
  }

  function canRemovePrecedingTag(optionalEndTag, tag) {
    switch (optionalEndTag) {
      case 'html':
      case 'head':
      case 'body':
      case 'colgroup':
      case 'caption':
        return true;
      case 'li':
      case 'optgroup':
      case 'tr':
        return tag === optionalEndTag;
      case 'dt':
      case 'dd':
        return descriptionTags(tag);
      case 'p':
        return pBlockTags(tag);
      case 'rb':
      case 'rt':
      case 'rp':
        return rubyTags(tag);
      case 'rtc':
        return rtcTag(tag);
      case 'option':
        return optionTag(tag);
      case 'thead':
      case 'tbody':
        return tableContentTags(tag);
      case 'tfoot':
        return tag === 'tbody';
      case 'td':
      case 'th':
        return cellTags(tag);
    }
    return false;
  }

  var reEmptyAttribute = new RegExp(
    '^(?:class|id|style|title|lang|dir|on(?:focus|blur|change|click|dblclick|mouse(' +
      '?:down|up|over|move|out)|key(?:press|down|up)))$');

  function canDeleteEmptyAttribute(tag, attrName, attrValue) {
    var isValueEmpty = !attrValue || (/^\s*$/).test(attrValue);
    if (isValueEmpty) {
      return (
        (tag === 'input' && attrName === 'value') ||
        reEmptyAttribute.test(attrName));
    }
    return false;
  }

  function hasAttrName(name, attrs) {
    for (var i = attrs.length - 1; i >= 0; i--) {
      if (attrs[i].name === name) {
        return true;
      }
    }
    return false;
  }

  function canRemoveElement(tag, attrs) {
    switch (tag) {
      case 'textarea':
        return false;
      case 'audio':
      case 'script':
      case 'video':
        if (hasAttrName('src', attrs)) {
          return false;
        }
        break;
      case 'iframe':
        if (hasAttrName('src', attrs) || hasAttrName('srcdoc', attrs)) {
          return false;
        }
        break;
      case 'object':
        if (hasAttrName('data', attrs)) {
          return false;
        }
        break;
      case 'applet':
        if (hasAttrName('code', attrs)) {
          return false;
        }
        break;
    }
    return true;
  }

  function canCollapseWhitespace(tag) {
    return !(/^(?:script|style|pre|textarea)$/.test(tag));
  }

  function canTrimWhitespace(tag) {
    return !(/^(?:pre|textarea)$/.test(tag));
  }

  function normalizeAttribute(attr, attrs, tag, hasUnarySlash, index, options, isLast) {

    var attrName = options.caseSensitive ? attr.name : attr.name.toLowerCase(),
        attrValue = attr.value,
        attrQuote = attr.quote,
        attrFragment,
        emittedAttrValue;

    if ((options.removeRedundantAttributes &&
      isAttributeRedundant(tag, attrName, attrValue, attrs))
      ||
      (options.removeScriptTypeAttributes &&
      isScriptTypeAttribute(tag, attrName, attrValue))
      ||
      (options.removeStyleLinkTypeAttributes &&
      isStyleLinkTypeAttribute(tag, attrName, attrValue))) {
      return '';
    }

    attrValue = cleanAttributeValue(tag, attrName, attrValue, options, attrs);

    if (options.removeEmptyAttributes &&
        canDeleteEmptyAttribute(tag, attrName, attrValue)) {
      return '';
    }

    if (attrValue !== undefined && !options.removeAttributeQuotes ||
        !canRemoveAttributeQuotes(attrValue)) {
      if (!options.preventAttributesEscaping) {
        if (options.quoteCharacter !== undefined) {
          attrQuote = options.quoteCharacter === '\'' ? '\'' : '"';
        }
        else {
          var apos = (attrValue.match(/'/g) || []).length;
          var quot = (attrValue.match(/"/g) || []).length;
          attrQuote = apos < quot ? '\'' : '"';
        }
        if (attrQuote === '"') {
          attrValue = attrValue.replace(/"/g, '&#34;');
        }
        else {
          attrValue = attrValue.replace(/'/g, '&#39;');
        }
      }
      emittedAttrValue = attrQuote + attrValue + attrQuote;
      if (!isLast && !options.removeTagWhitespace) {
        emittedAttrValue += ' ';
      }
    }
    // make sure trailing slash is not interpreted as HTML self-closing tag
    else if (isLast && !hasUnarySlash && !/\/$/.test(attrValue)) {
      emittedAttrValue = attrValue;
    }
    else {
      emittedAttrValue = attrValue + ' ';
    }

    if (attrValue === undefined || (options.collapseBooleanAttributes &&
        isBooleanAttribute(attrName.toLowerCase(), attrValue.toLowerCase()))) {
      attrFragment = attrName;
      if (!isLast) {
        attrFragment += ' ';
      }
    }
    else {
      attrFragment = attrName + attr.customAssign + emittedAttrValue;
    }

    return attr.customOpen + attrFragment + attr.customClose;
  }

  function setDefaultTesters(options) {

    var defaultTesters = ['canCollapseWhitespace', 'canTrimWhitespace'];

    for (var i = 0, len = defaultTesters.length; i < len; i++) {
      if (!options[defaultTesters[i]]) {
        options[defaultTesters[i]] = function() {
          return false;
        };
      }
    }
  }

  function minifyURLs(text, options) {
    if (typeof options !== 'object') {
      options = { };
    }

    try {
      // try to get global reference first
      var __RelateUrl = global.RelateUrl;

      if (typeof __RelateUrl === 'undefined' && typeof require === 'function') {
        __RelateUrl = require('relateurl');
      }

      // noop
      if (!__RelateUrl) {
        return text;
      }

      if (__RelateUrl.relate) {
        return __RelateUrl.relate(text, options);
      }
      else {
        return text;
      }
    }
    catch (err) {
      log(err);
    }
    return text;
  }

  function minifyJS(text, options) {
    if (typeof options !== 'object') {
      options = { };
    }
    options.fromString = true;
    var outputOptions = options.output || {};
    outputOptions.inline_script = true;
    options.output = outputOptions;

    try {
      // try to get global reference first
      var __UglifyJS = global.UglifyJS;

      if (typeof __UglifyJS === 'undefined' && typeof require === 'function') {
        __UglifyJS = require('uglify-js');
      }

      // noop
      if (!__UglifyJS) {
        return text;
      }

      if (__UglifyJS.minify) {
        return __UglifyJS.minify(text, options).code;
      }
      else if (__UglifyJS.parse) {

        var ast = __UglifyJS.parse(text);
        ast.figure_out_scope();

        var compressor = __UglifyJS.Compressor();
        var compressedAst = ast.transform(compressor);

        compressedAst.figure_out_scope();
        compressedAst.compute_char_frequency();

        if (options.mangle !== false) {
          compressedAst.mangle_names();
        }

        var stream = __UglifyJS.OutputStream(options.output);
        compressedAst.print(stream);

        return stream.toString();
      }
      else {
        return text;
      }
    }
    catch (err) {
      log(err);
    }
    return text;
  }

  function minifyCSS(text, options, inline) {
    if (typeof options !== 'object') {
      options = { };
    }
    if (typeof options.advanced === 'undefined') {
      options.advanced = false;
    }
    try {
      var CleanCSS = global.CleanCSS;
      if (typeof CleanCSS === 'undefined' && typeof require === 'function') {
        CleanCSS = require('clean-css');
      }
      var cleanCSS = new CleanCSS(options);
      if (inline) {
        return unwrapCSS(cleanCSS.minify(wrapCSS(text)).styles);
      }
      else {
        return cleanCSS.minify(text).styles;
      }
    }
    catch (err) {
      log(err);
    }
    return text;
  }

  function uniqueId(value) {
    var id;
    do {
      id = Math.random().toString(36).slice(2);
    } while (~value.indexOf(id));
    return id;
  }

  function minify(value, options, partialMarkup) {
    options = options || {};
    var optionsStack = [];
    setDefaultTesters(options);
    value = options.collapseWhitespace ? trimWhitespace(value) : value;

    var buffer = [ ],
        charsPrevTag,
        currentChars = '',
        hasChars,
        currentTag = '',
        currentAttrs = [],
        stackNoTrimWhitespace = [],
        stackNoCollapseWhitespace = [],
        optionalStartTag = '',
        optionalEndTag = '',
        lint = options.lint,
        t = Date.now(),
        ignoredMarkupChunks = [ ],
        ignoredCustomMarkupChunks = [ ],
        uidIgnore,
        uidAttr;

    // temporarily replace ignored chunks with comments,
    // so that we don't have to worry what's there.
    // for all we care there might be
    // completely-horribly-broken-alien-non-html-emoj-cthulhu-filled content
    value = value.replace(/<!-- htmlmin:ignore -->([\s\S]*?)<!-- htmlmin:ignore -->/g, function(match, group1) {
      if (!uidIgnore) {
        uidIgnore = '<!--!' + uniqueId(value) + '-->';
      }
      var token = uidIgnore + ignoredMarkupChunks.length;
      ignoredMarkupChunks.push(group1);
      return token;
    });

    var customFragments = (options.ignoreCustomFragments || [
      /<%[\s\S]*?%>/,
      /<\?[\s\S]*?\?>/
    ]).map(function(re) {
      return re.source;
    });
    if (customFragments.length) {
      var reCustomIgnore = new RegExp('\\s*(?:' + customFragments.join('|') + ')+\\s*', 'g');
      // temporarily replace custom ignored fragments with unique attributes
      value = value.replace(reCustomIgnore, function(match) {
        if (!uidAttr) {
          uidAttr = uniqueId(value);
        }
        var token = uidAttr + ignoredCustomMarkupChunks.length;
        ignoredCustomMarkupChunks.push(match);
        return '\t' + token + '\t';
      });
    }

    function _canCollapseWhitespace(tag, attrs) {
      return canCollapseWhitespace(tag) || options.canCollapseWhitespace(tag, attrs);
    }

    function _canTrimWhitespace(tag, attrs) {
      return canTrimWhitespace(tag) || options.canTrimWhitespace(tag, attrs);
    }

    function removeStartTag() {
      var index = buffer.length - 1;
      while (index > 0 && !/^<[^/!]/.test(buffer[index])) {
        index--;
      }
      buffer.length = Math.max(0, index);
    }

    function removeEndTag() {
      var index = buffer.length - 1;
      while (index > 0 && !/^<\//.test(buffer[index])) {
        index--;
      }
      buffer.length = Math.max(0, index);
    }

    // look for trailing whitespaces from previously processed text
    // which may not be trimmed due to a following comment or an empty
    // element which has now been removed
    function squashTrailingWhitespace(nextTag) {
      var charsIndex;
      if (buffer.length > 1 && /^(?:<!|$)/.test(buffer[buffer.length - 1]) &&
          /\s$/.test(buffer[buffer.length - 2])) {
        charsIndex = buffer.length - 2;
      }
      else if (buffer.length > 0 && /\s$/.test(buffer[buffer.length - 1])) {
        charsIndex = buffer.length - 1;
      }
      if (charsIndex > 0) {
        buffer[charsIndex] = buffer[charsIndex].replace(/\s+$/, function(text) {
          return collapseWhitespaceSmart(text, 'comment', nextTag, options);
        });
      }
    }

    new HTMLParser(value, {
      partialMarkup: partialMarkup,
      html5: typeof options.html5 !== 'undefined' ? options.html5 : true,

      start: function(tag, attrs, unary, unarySlash) {
        var lowerTag = tag.toLowerCase();

        if (lowerTag === 'svg') {
          optionsStack.push(options);
          var nextOptions = {};
          for (var key in options) {
            nextOptions[key] = options[key];
          }
          nextOptions.keepClosingSlash = true;
          nextOptions.caseSensitive = true;
          options = nextOptions;
        }

        tag = options.caseSensitive ? tag : lowerTag;

        currentTag = tag;
        charsPrevTag = tag;
        if (!inlineTextTags(tag)) {
          currentChars = '';
        }
        hasChars = false;
        currentAttrs = attrs;

        var optional = options.removeOptionalTags;
        if (optional) {
          var htmlTag = htmlTags(tag);
          // <html> may be omitted if first thing inside is not comment
          // <head> may be omitted if first thing inside is an element
          // <body> may be omitted if first thing inside is not space, comment, <meta>, <link>, <script>, <style> or <template>
          // <colgroup> may be omitted if first thing inside is <col>
          // <tbody> may be omitted if first thing inside is <tr>
          if (htmlTag && canRemoveParentTag(optionalStartTag, tag)) {
            removeStartTag();
          }
          optionalStartTag = '';
          // end-tag-followed-by-start-tag omission rules
          if (htmlTag && canRemovePrecedingTag(optionalEndTag, tag)) {
            removeEndTag();
            // <colgroup> cannot be omitted if preceding </colgroup> is omitted
            // <tbody> cannot be omitted if preceding </tbody>, </thead> or </tfoot> is omitted
            optional = !isStartTagMandatory(optionalEndTag, tag);
          }
          optionalEndTag = '';
        }

        // set whitespace flags for nested tags (eg. <code> within a <pre>)
        if (options.collapseWhitespace) {
          if (!stackNoTrimWhitespace.length) {
            squashTrailingWhitespace(tag);
          }
          if (!_canTrimWhitespace(tag, attrs)) {
            stackNoTrimWhitespace.push(tag);
          }
          if (!_canCollapseWhitespace(tag, attrs)) {
            stackNoCollapseWhitespace.push(tag);
          }
        }

        var openTag = '<' + tag;
        var hasUnarySlash = unarySlash && options.keepClosingSlash;

        buffer.push(openTag);

        if (lint) {
          lint.testElement(tag);
        }

        var parts = [ ];
        var token, isLast = true;
        for (var i = attrs.length; --i >= 0; ) {
          if (lint) {
            lint.testAttribute(tag, attrs[i].name.toLowerCase(), attrs[i].value);
          }
          token = normalizeAttribute(attrs[i], attrs, tag, hasUnarySlash, i, options, isLast);
          if (token) {
            isLast = false;
            parts.unshift(token);
          }
        }
        if (parts.length > 0) {
          buffer.push(' ');
          buffer.push.apply(buffer, parts);
        }
        // start tag must never be omitted if it has any attributes
        else if (optional && optionalStartTags(tag)) {
          optionalStartTag = tag;
        }

        buffer.push(buffer.pop() + (hasUnarySlash ? '/' : '') + '>');
      },
      end: function(tag, attrs) {
        var lowerTag = tag.toLowerCase();
        if (lowerTag === 'svg') {
          options = optionsStack.pop();
        }
        tag = options.caseSensitive ? tag : lowerTag;

        // check if current tag is in a whitespace stack
        if (options.collapseWhitespace) {
          if (stackNoTrimWhitespace.length) {
            if (tag === stackNoTrimWhitespace[stackNoTrimWhitespace.length - 1]) {
              stackNoTrimWhitespace.pop();
            }
          }
          else {
            squashTrailingWhitespace('/' + tag);
          }
          if (stackNoCollapseWhitespace.length &&
            tag === stackNoCollapseWhitespace[stackNoCollapseWhitespace.length - 1]) {
            stackNoCollapseWhitespace.pop();
          }
        }

        var isElementEmpty = false;
        if (tag === currentTag) {
          currentTag = '';
          isElementEmpty = !hasChars;
        }

        if (options.removeOptionalTags) {
          // <html>, <head> or <body> may be omitted if the element is empty
          if (isElementEmpty && topLevelTags(optionalStartTag)) {
            removeStartTag();
          }
          optionalStartTag = '';
          // </html> or </body> may be omitted if not followed by comment
          // </head> may be omitted if not followed by space or comment
          // </p> may be omitted if no more content in non-</a> parent
          // except for </dt> or </thead>, end tags may be omitted if no more content in parent element
          if (htmlTags(tag) && optionalEndTag && !trailingTags(optionalEndTag) && (optionalEndTag !== 'p' || !pInlineTags(tag))) {
            removeEndTag();
          }
          optionalEndTag = optionalEndTags(tag) ? tag : '';
        }

        if (options.removeEmptyElements && isElementEmpty && canRemoveElement(tag, attrs)) {
          // remove last "element" from buffer
          removeStartTag();
          optionalStartTag = '';
          optionalEndTag = '';
        }
        else {
          // push out everything but the end tag
          buffer.push('</' + tag + '>');
          charsPrevTag = '/' + tag;
          if (!inlineTextTags(tag)) {
            currentChars = '';
          }
        }
      },
      chars: function(text, prevTag, nextTag) {
        prevTag = prevTag === '' ? 'comment' : prevTag;
        nextTag = nextTag === '' ? 'comment' : nextTag;
        if (options.collapseWhitespace) {
          if (!stackNoTrimWhitespace.length) {
            if (prevTag === 'comment') {
              var removed = buffer[buffer.length - 1] === '';
              if (removed) {
                prevTag = charsPrevTag;
              }
              if (buffer.length > 1 && (removed || / $/.test(currentChars))) {
                var charsIndex = buffer.length - 2;
                buffer[charsIndex] = buffer[charsIndex].replace(/\s+$/, function(trailingSpaces) {
                  text = trailingSpaces + text;
                  return '';
                });
              }
            }
            if (prevTag && inlineTextTags(prevTag.charAt(0) === '/' ? prevTag.slice(1) : prevTag)) {
              text = collapseWhitespace(text, options, /(?:^|\s)$/.test(currentChars));
            }
            text = prevTag || nextTag ? collapseWhitespaceSmart(text, prevTag, nextTag, options) : trimWhitespace(text);
            if (!text && /\s$/.test(currentChars) && prevTag && prevTag.charAt(0) === '/') {
              for (var index = buffer.length - 2, endTag = prevTag.slice(1); index >= 0 && _canTrimWhitespace(endTag); index--) {
                var str = buffer[index];
                var match = str.match(/^<\/([\w:-]+)>$/);
                if (match) {
                  endTag = match[1];
                }
                else if (/>$/.test(str) || (buffer[index] = collapseWhitespaceSmart(str, null, nextTag, options))) {
                  break;
                }
              }
            }
          }
          if (!stackNoCollapseWhitespace.length) {
            text = prevTag && nextTag || nextTag === 'html' ? text : collapseWhitespaceAll(text);
          }
        }
        if (currentTag === 'script' || currentTag === 'style') {
          if (options.removeCommentsFromCDATA) {
            text = removeComments(text, currentTag);
          }
          if (options.removeCDATASectionsFromCDATA) {
            text = removeCDATASections(text);
          }
          if (options.processScripts) {
            text = processScript(text, options, currentAttrs);
          }
        }
        if (options.minifyJS && isExecutableScript(currentTag, currentAttrs)) {
          text = minifyJS(text, options.minifyJS);
          if (text.charAt(text.length - 1) === ';') {
            text = text.slice(0, -1);
          }
        }
        if (currentTag === 'style' && options.minifyCSS) {
          text = minifyCSS(text, options.minifyCSS);
        }
        if (options.removeOptionalTags && text) {
          // <html> may be omitted if first thing inside is not comment
          // <body> may be omitted if first thing inside is not space, comment, <meta>, <link>, <script>, <style> or <template>
          if (optionalStartTag === 'html' || optionalStartTag === 'body' && !/^\s/.test(text)) {
            removeStartTag();
          }
          optionalStartTag = '';
          // </html> or </body> may be omitted if not followed by comment
          // </head>, </colgroup> or </caption> may be omitted if not followed by space or comment
          if (compactTags(optionalEndTag) || looseTags(optionalEndTag) && !/^\s/.test(text)) {
            removeEndTag();
          }
          optionalEndTag = '';
        }
        charsPrevTag = /^\s*$/.test(text) ? prevTag : 'comment';
        currentChars += text;
        if (text) {
          hasChars = true;
        }
        if (lint) {
          lint.testChars(text);
        }
        buffer.push(text);
      },
      comment: function(text, nonStandard) {
        var prefix = nonStandard ? '<!' : '<!--';
        var suffix = nonStandard ? '>' : '-->';
        if (isConditionalComment(text)) {
          text = prefix + cleanConditionalComment(text, options) + suffix;
        }
        else if (options.removeComments) {
          if (isIgnoredComment(text, options)) {
            text = '<!--' + text + '-->';
          }
          else {
            text = '';
          }
        }
        else {
          text = prefix + text + suffix;
        }
        if (options.removeOptionalTags && text) {
          // preceding comments suppress tag omissions
          optionalStartTag = '';
          optionalEndTag = '';
        }
        buffer.push(text);
      },
      doctype: function(doctype) {
        buffer.push(options.useShortDoctype ? '<!DOCTYPE html>' : collapseWhitespaceAll(doctype));
      },
      customAttrAssign: options.customAttrAssign,
      customAttrSurround: options.customAttrSurround
    });

    if (options.removeOptionalTags) {
      // <html> may be omitted if first thing inside is not comment
      // <head> or <body> may be omitted if empty
      if (topLevelTags(optionalStartTag)) {
        removeStartTag();
      }
      // except for </dt> or </thead>, end tags may be omitted if no more content in parent element
      if (optionalEndTag && !trailingTags(optionalEndTag)) {
        removeEndTag();
      }
    }

    var str = joinResultSegments(buffer, options);

    if (uidAttr) {
      str = str.replace(new RegExp('(\\s*)' + uidAttr + '([0-9]+)(\\s*)', 'g'), function(match, prefix, index, suffix) {
        var chunk = ignoredCustomMarkupChunks[+index];
        if (options.collapseWhitespace) {
          if (prefix !== '\t') {
            chunk = prefix + chunk;
          }
          if (suffix !== '\t') {
            chunk += suffix;
          }
          return collapseWhitespace(chunk, {
            preserveLineBreaks: options.preserveLineBreaks,
            conservativeCollapse: true
          }, /^\s/.test(chunk), /\s$/.test(chunk));
        }
        else {
          return chunk;
        }
      });
    }
    if (uidIgnore) {
      str = str.replace(new RegExp(uidIgnore + '([0-9]+)', 'g'), function(match, index) {
        return ignoredMarkupChunks[+index];
      });
    }

    log('minified in: ' + (Date.now() - t) + 'ms');
    return str;
  }

  function joinResultSegments(results, options) {
    var str;
    var maxLineLength = options.maxLineLength;
    if (maxLineLength) {
      var token;
      var lines = [];
      var line = '';
      for (var i = 0, len = results.length; i < len; i++) {
        token = results[i];
        if (line.length + token.length < maxLineLength) {
          line += token;
        }
        else {
          lines.push(line.replace(/^\n/, ''));
          line = token;
        }
      }
      lines.push(line);

      str = lines.join('\n');
    }
    else {
      str = results.join('');
    }

    return options.collapseWhitespace ? trimWhitespace(str) : str;
  }

  global.minify = function(value, options) {
    return minify(value, options);
  };

}(typeof exports === 'undefined' ? this : exports));
