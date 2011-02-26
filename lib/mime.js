
try{
    // see http://github.com/bnoordhuis/node-iconv for more info
    var Iconv = require("iconv").Iconv;
}catch(E){
    // convert nothing
    Iconv = function(){}
    Iconv.prototype.convert = function(str){return str};
}
/* mime related functions - encoding/decoding etc*/
/* TODO: Only UTF-8 and Latin1 are allowed with encodeQuotedPrintable */
/* TODO: Check if the input string even needs encoding                */

/**
 * mime.foldLine(str, maxLength, foldAnywhere) -> String
 * - str (String): mime string that might need folding
 * - maxLength (Number): max length for a line, defaults to 78
 * - foldAnywhere (Boolean): can fold at any location (ie. in base64)
 * - afterSpace (Boolean): If [true] fold after the space
 * 
 * Folds a long line according to the RFC 5322
 *   <http://tools.ietf.org/html/rfc5322#section-2.1.1>
 * 
 * For example:
 *     Content-Type: multipart/alternative; boundary="----bd_n3-lunchhour1283962663300----"
 * will become
 *     Content-Type: multipart/alternative;
 *      boundary="----bd_n3-lunchhour1283962663300----"
 * 
 **/
this.foldLine = function(str, maxLength, foldAnywhere, afterSpace){
    var line=false, curpos=0, response="", lf;
    maxLength = maxLength || 78;
    
    // return original if no need to fold
    if(str.length<=maxLength)
        return str;
    
    // read in <maxLength> bytes and try to fold it
    while(line = str.substr(curpos, maxLength)){
        if(!!foldAnywhere){
            response += line;
            if(curpos+maxLength<str.length){
                response+="\r\n";
            }
        }else{
            lf = line.lastIndexOf(" ");
            if(lf<=0)
                lf = line.lastIndexOf("\t");
            if(line.length>=maxLength && lf>0){
                if(!!afterSpace){
                    // move forward until line end or no more \s and \t
                    while(lf<line.length && (line.charAt(lf)==" " || line.charAt(lf)=="\t")){
                        lf++;
                    }
                }
                response += line.substr(0,lf)+"\r\n"+(!foldAnywhere && !afterSpace && "       " || "");
                curpos -= line.substr(lf).length;
            }else
                response+=line;
        }
        curpos += line.length;
    }
    
    // return folded string
    return response;
}


/**
 * mime.encodeMimeWord(str, encoding, charset) -> String
 * - str (String): String to be encoded
 * - encoding (String): Encoding Q for quoted printable or B (def.) for base64
 * - charset (String): Charset to be used
 * 
 * Encodes a string into mime encoded word format
 *   <http://en.wikipedia.org/wiki/MIME#Encoded-Word>
 *
 * For example:
 *     See on õhin test
 * Becomes with UTF-8 and Quoted-printable encoding
 *     =?UTF-8?q?See_on_=C3=B5hin_test?=
 * 
 **/
this.encodeMimeWord = function(str, encoding, charset){
    charset = charset || "UTF-8";
    encoding = encoding && encoding.toUpperCase() || "B";
    
    if(encoding=="Q"){
        str = this.encodeQuotedPrintable(str, true, charset);
    }
    
    if(encoding=="B"){
        str = this.encodeBase64(str);
    }
    
    return "=?"+charset+"?"+encoding+"?"+str+"?=";
}

/**
 * mime.decodeMimeWord(str, encoding, charset) -> String
 * - str (String): String to be encoded
 * - encoding (String): Encoding Q for quoted printable or B (def.) for base64
 * - charset (String): Charset to be used, defaults to UTF-8
 * 
 * Decodes a string from mime encoded word format, see [[encodeMimeWord]]
 * 
 **/

this.decodeMimeWord = function(str){
    var parts = str.split("?"),
        charset = parts && parts[1],
        encoding = parts && parts[2],
        text = parts && parts[3];
    if(!charset || !encoding || !text)
        return str;
    if(encoding.toUpperCase()=="Q"){
        return this.decodeQuotedPrintable(text, true, charset);
    }
    
    if(encoding.toUpperCase()=="B"){
        return this.decodeBase64(text);
    }
    
    return text;
}


/**
 * mime.encodeQuotedPrintable(str, mimeWord, charset) -> String
 * - str (String): String to be encoded into Quoted-printable
 * - mimeWord (Boolean): Use mime-word mode (defaults to false)
 * - charset (String): Destination charset, defaults to UTF-8
 *   TODO: Currently only allowed charsets: UTF-8, LATIN1
 * 
 * Encodes a string into Quoted-printable format. 
 **/
this.encodeQuotedPrintable = function(str, mimeWord, charset){
    charset = charset || "UTF-8";
    
    /*
     * Characters from 33-126 OK (except for =; and ?_ when in mime word mode)
     * Spaces + tabs OK (except for line beginnings and endings)  
     * \n + \r OK
     */
    
    str = str.replace(/[^\sa-zA-Z\d]/gm,function(c){
        if(!!mimeWord){
            if(c=="?")return "=3F";
            if(c=="_")return "=5F";
        }
        if(c!=="=" && c.charCodeAt(0)>=33 && c.charCodeAt(0)<=126)
            return c;
        return c=="="?"=3D":(charset=="UTF-8"?encodeURIComponent(c):escape(c)).replace(/%/g,'=');
    });
    
    str = lineEdges(str);

    if(!mimeWord){
        // lines might not be longer than 76 bytes, soft break: "=\r\n"
        var lines = str.split(/\r?\n/);
        for(var i=0, len = lines.length; i<len; i++){
            if(lines[i].length>76){
                lines[i] = this.foldLine(lines[i],76, false, true).replace(/\r\n/g,"=\r\n");
            }
        }
        str = lines.join("\r\n");
    }else{
        str = str.replace(/\s/g, function(a){
            if(a==" ")return "_";
            if(a=="\t")return "=09";
            return a=="\r"?"=0D":"=0A";
        });
    }

    return str;
}

/**
 * mime.deccodeQuotedPrintable(str, mimeWord, charset) -> String
 * - str (String): String to be decoded
 * - mimeWord (Boolean): Use mime-word mode (defaults to false)
 * - charset (String): Charset to be used, defaults to UTF-8
 * 
 * Decodes a string from Quoted-printable format. 
 **/
this.decodeQuotedPrintable = function(str, mimeWord, charset){
    charset = charset && charset.toUpperCase() || "UTF-8";

    if(mimeWord){
        str = str.replace(/_/g," ");
    }else{
        str = str.replace(/=\r\n/gm,'');
        str = str.replace(/=$/,"");
    }
    if(charset == "UTF-8")
        str = decodeURIComponent(str.replace(/=/g,"%"));
    else{
        str = str.replace(/=/g,"%");
        if(charset=="ISO-8859-1" || charset=="LATIN1")
            str = unescape(str);
        else{
            str = decodeBytestreamUrlencoding(str);
            str = fromCharset(charset, str);
        }
    }
    return str;
}

/**
 * mime.encodeBase64(str) -> String
 * - str (String): String to be encoded into Base64
 * - charset (String): Destination charset, defaults to UTF-8
 * 
 * Encodes a string into Base64 format. Base64 is mime-word safe. 
 **/
this.encodeBase64 = function(str, charset){
    var buffer;
    if(charset && charset.toUpperCase()!="UTF-8")
        buffer = toCharset(charset, str);
    else
        buffer = new Buffer(str, "UTF-8");
    return buffer.toString("base64");
}

/**
 * mime.decodeBase64(str) -> String
 * - str (String): String to be decoded from Base64
 * - charset (String): Source charset, defaults to UTF-8
 * 
 * Decodes a string from Base64 format. Base64 is mime-word safe.
 * NB! Always returns UTF-8 
 **/
this.decodeBase64 = function(str, charset){
    var buffer = new Buffer(str, "base64");
    
    if(charset && charset.toUpperCase()!="UTF-8"){
        return fromCharset(charset, buffer);
    }
    
    // defaults to utf-8
    return buffer.toString("UTF-8");
}

/**
 * mime.parseHeaders(headers) -> Array
 * - headers (String): header section of the e-mail
 * 
 * Parses header lines into an array of objects (see [[parseHeaderLine]])
 * FIXME: This should probably not be here but in "envelope" instead
 **/
this.parseHeaders = function(headers){
    var text, lines, line, i, name, value, cmd, header_lines = {};
    // unfold
    headers = headers.replace(/\r?\n([ \t])/gm," ");

    // split lines
    lines = headers.split(/\r?\n/);
    for(i=0; i<lines.length;i++){
        if(!lines[i]) // no more header lines
            break;
        cmd = lines[i].match(/[^\:]+/);
        if(cmd && (cmd = cmd[0])){
            name = cmd;
            value = lines[i].substr(name.length+1);
            if(!header_lines[name.toLowerCase().trim()])header_lines[name.toLowerCase().trim()] = [];
            header_lines[name.toLowerCase()].push(value.trim());
        }
    }
    
    return header_lines;
}

/**
 * mime.parseAddresses(addresses) -> Array
 * - addresses (String): string with comma separated e-mail addresses
 * 
 * Parses names and addresses from a from, to, cc or bcc line
 **/
this.parseAddresses = function(addresses){
    if(!addresses)
        return {};

    addresses = addresses.replace(/=\?[^?]+\?[QqBb]\?[^?]+\?=/g, (function(a){return this.decodeMimeWord(a)}).bind(this));
    
    // not sure if it's even needed - urlencode escaped \\ and \" and \'
    addresses = addresses.replace(/\\\\/g,function(a){return escape(a.charAt(1))});
    addresses = addresses.replace(/\\["']/g,function(a){return escape(a.charAt(1))});
    
    var list = addresses.split(","), address, addressArr = [], name, email;
    for(var i=0, len=list.length; i<len; i++){
        address = list[i].trim();
        if(address.match(/[\s"'<>()]/)){ // address with comments (name)
            email = false;
            address = address.replace(/<([^>]+)>/,function(a,b){
                email = b.indexOf("@")>=0 && b;
                return email?"":a;
            });
            address = address.trim();
            if(email){
                name = address.replace(/"/g,"").trim();
            }else{ // try brackets
                address = address.replace(/\(([^)]+)\)/,function(a,b){
                    name = b;
                    return "";
                });
                email = address.indexOf("@")>=0 && address.trim();
            }
            // just in case something got mixed up
            if(!email && name.indexOf("@")>=0){
                email = name;
                name = false;
            }
            if(email)
                addressArr.push({address:decodeURIComponent(email), name: decodeURIComponent(name)});
        }else if(address.indexOf("@")>=0)
            addressArr.push({address:address, name:false});
    }
    return addressArr;
}

/**
 * mime.parseMimeWords(str) -> String
 * - str (String): string to be parsed
 * 
 * Parses mime-words into UTF-8 strings
 **/
this.parseMimeWords = function(str){
    return str.replace(/=\?[^?]+\?[QqBb]\?[^?]+\?=/g, (function(a){
        return this.decodeMimeWord(a);
    }).bind(this));
}

/**
 * mime.parseHeaderLine(line) -> Object
 * - line (String): a line from a message headers
 * 
 * Parses a header line to search for additional parameters.
 * For example with "text/plain; charset=utf-8" the output would be
 *   - defaultValue = text/plain
 *   - charset = utf-8
 **/
this.parseHeaderLine = function(line){
    if(!line)
        return {};
    var result = {}, parts = line.split(";"), pos;
    for(var i=0, len = parts.length; i<len; i++){
        pos = parts[i].indexOf("=");
        if(pos<0){
            result[!i?"defaultValue":"i-"+i] = parts[i].trim();
        }else{
            result[parts[i].substr(0,pos).trim().toLowerCase()] = parts[i].substr(pos+1).trim();
        }
    }
    return result;
}

/**
 * mime.stripHTML(str) -> String
 * - str (String): HTML string to be converted
 * 
 * Converts a HTML string into plain text
 **/
this.stripHTML = function(str){
    if(!str)return str;
    
    str = str instanceof Buffer ? str.toString("utf-8"):str;
    
    str = str.replace(/\r?\n/g," ");
    str = str.replace(/<(?:\/p|br|\/tr|\/table|\/div)>/g,"\n");

    // hide newlines with two 00 chars (enables multiline matches)
    str = str.replace(/\r?\n/g,"-\u0000\u0000-");
    
    // H1-H6, add underline
    str = str.replace(/<[hH]\d[^>]*>(.*?)<\/[hH]\d[^>]*>/g,function(a,b){
        var line = "";
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();
        
        if(!b)
            return "";
        for(var i=0, len = b.length; i<len; i++){
            line+="-";
        }
        return b+"\n"+line+"\n\n";
    });

    // LI, indent by 2 spaces + *
    str = str.replace(/<li[^>]*>(.*?)<\/?(?:li|ol|ul)[^>]*>/ig,function(a,b){
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();
        
        if(!b)
            return "";
        return "-®®®®-* "+b+"\n";
    });

    // PRE, indent by 4 spaces
    str = str.replace(/<pre[^>]*>(.*?)<\/pre[^>]*>/ig,function(a,b){
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();
        
        if(!b)
            return "";

        b = b.replace(/[ \t]*\n[ \t]*/g,"\n-®®®®--®®®®-");
        
        return "\n-®®®®--®®®®-"+b.trim()+"\n\n";
    });

    // restore 
    str = str.replace(/\s*-\u0000\u0000-\s*/g,"\n");
    
    // remove all remaining html tags
    str = str.replace(/<[^>]*>/g," ");
    // remove duplicate spaces
    str = str.replace(/[ ][ ]+/g," ");
    // remove spaces before and after newlines
    str = str.replace(/[ \t]*\n[ \t]*/g,"\n");
    // remove more than 2 newlines in a row
    str = str.replace(/\n\n+/g,"\n\n");
    // restore hidden spaces (four (r) signs for two spaces)
    str = str.replace(/-®®®®-/g,"  ");
    return str.trim();
}

this.mime_types = {
    "doc": "application/msword",
    "docx": "application/msword",
    "pdf": "application/pdf",
    "rss": "application/rss+xml",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.ms-excel",
    "pps": "application/vnd.ms-powerpoint",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.ms-powerpoint",
    "odp": "application/vnd.oasis.opendocument.presentation",
    "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "odt": "application/vnd.oasis.opendocument.text",
    "sxc": "application/vnd.sun.xml.calc",
    "sxw": "application/vnd.sun.xml.writer",
    "au": "audio/basic",
    "snd": "audio/basic",
    "flac": "audio/flac",
    "mid": "audio/mid",
    "rmi": "audio/mid",
    "m4a": "audio/mp4",
    "mp3": "audio/mpeg",
    "oga": "audio/ogg",
    "ogg": "audio/ogg",
    "aif": "audio/x-aiff",
    "aifc": "audio/x-aiff",
    "aiff": "audio/x-aiff",
    "wav": "audio/x-wav",
    "gif": "image/gif",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "jpe": "image/jpeg",
    "png": "image/png",
    "tiff": "image/tiff",
    "tif": "image/tiff",
    "wbmp": "image/vnd.wap.wbmp",
    "bmp": "image/x-ms-bmp",
    "ics": "text/calendar",
    "csv": "text/comma-separated-values",
    "css": "text/css",
    "htm": "text/html",
    "html": "text/html",
    "text": "text/plain",
    "txt": "text/plain",
    "asc": "text/plain",
    "diff": "text/plain",
    "pot": "text/plain",
    "vcf": "text/x-vcard",
    "mp4": "video/mp4",
    "mpeg": "video/mpeg",
    "mpg": "video/mpeg",
    "mpe": "video/mpeg",
    "ogv": "video/ogg",
    "qt": "video/quicktime",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "zip": "application/zip",
    "rar": "application/x-rar-compressed"
}

/* Helper functions */

/**
 * lineEdges(str) -> String
 * - str (String): String to be processed
 * 
 * Replaces all spaces and tabs in the beginning and end of the string
 * with quoted printable encoded chars. Needed by [[encodeQuotedPrintable]]
 **/
function lineEdges(str){
    str = str.replace(/^[ \t]+/gm, function(wsc){
        return wsc.replace(/ /g,"=20").replace(/\t/g,"=09"); 
    });
    
    str = str.replace(/[ \t]+$/gm, function(wsc){
        return wsc.replace(/ /g,"=20").replace(/\t/g,"=09"); 
    });
    return str;
}

/**
 * fromCharset(charset, buffer, keep_buffer) -> String | Buffer
 * - charset (String): Source charset
 * - buffer (Buffer): Buffer in <charset>
 * - keep_buffer (Boolean): If true, return buffer, otherwise UTF-8 string
 * 
 * Converts a buffer in <charset> codepage into UTF-8 string
 **/
function fromCharset(charset, buffer, keep_buffer){
    var iconv = new Iconv(charset,'UTF-8'),
        buffer = iconv.convert(buffer);
    return keep_buffer?buffer:buffer.toString("utf-8");
}

/**
 * toCharset(charset, buffer) -> Buffer
 * - charset (String): Source charset
 * - buffer (Buffer): Buffer in UTF-8 or string
 * 
 * Converts a string or buffer to <charset> codepage
 **/
function toCharset(charset, buffer){
    var iconv = new Iconv('UTF-8',charset);
    return iconv.convert(buffer);
}

/**
 * decodeBytestreamUrlencoding(encoded_string) -> Buffer
 * - encoded_string (String): String in urlencode coding
 * 
 * Converts an urlencoded string into a bytestream buffer. If the used
 * charset is known the resulting string can be converted to UTF-8 with
 * [[fromCharset]]. 
 * NB! For UTF-8 use decodeURIComponent and for Latin 1 decodeURL instead 
 **/
function decodeBytestreamUrlencoding(encoded_string){
    var c, i, j=0, prcnts = encoded_string.match(/%/g) || "",
            buffer_length = encoded_string.length - (prcnts.length*2),
        buffer = new Buffer(buffer_length);

    for(var i=0; i<encoded_string.length; i++){
        c = encoded_string.charCodeAt(i);
        if(c=="37"){ // %
            c = parseInt(encoded_string.substr(i+1,2), 16);
            i+=2;
        }
        buffer[j++] = c;
    }
    return buffer;
}

