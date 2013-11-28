"use strict";

var he = require("he");

// expose to the world
module.exports.stripHTML = stripHTML;

/**
 * <p>Converts a HTML stringo into plaintext format that resembles Markdown</p>
 *
 * <p>Only good for simple and valid HTML, probably breaks on eveything else</p>
 *
 * <p>Placeholders:</p>
 *
 * <ul>
 *     <li>-\u0000\u0000- for newline</li>
 *     <li>-\u0001\u0001- for a space</li>
 *     <li>-\u0002\u0002- temporary newlines</li>
 * </ul>
 *
 * @param {String} str HTML string to convert
 * @return {String} Plaintext that resembles Markdown
 */
function stripHTML(str){
    str = (str || "").toString("utf-8").trim();

    // remove head
    str = str.replace(/<head[\s\S]{1,}?\/head>/gi, '');

    // replace newlines
    str = str.replace(/\r?\n|\r/g,"-\u0002\u0002-");

    // convert block element endings to linebreak markers
    str = str.replace(/<(?:\/p|br\s*\/*|\/tr|\/table|\/div)>/g,"-\u0000\u0000--\u0000\u0000-");

    // H1-H6, add underline or prepend with #
    str = str.replace(/<[hH](\d)[^>]*>(.*?)<\/[hH]\d[^>]*>/g,function(match, level, content){
        var line = "",
            symbol, // line symbol char
            len;

        level = Number(level) || 0;

        content = he.decode(content.replace(/<[^>]*>/g," ").
                    replace(/\s\s+/g," ")).
                    trim();

        if(!content){
            // the tag was empty or only included other tags (<img> and such), nothing to show
            return "";
        }

        // select correct symbol for the line
        switch(level){
            case 1:
                symbol = "=";
                len = content.length;
                break;
            case 2:
                symbol = "-";
                len = content.length;
                break;
            default:
                symbol = "#";
                len = level;
        }

        line = new Array(len+1).join(symbol);

        if(symbol == "#"){
            // prepend the line:
            // ### This is a H3
            return line + " " + content + "\n\n";
        }else{
            // add underline:
            // This is a H1
            // ============
            return content + "\n" + line + "\n\n";
        }

    });

    // B
    str = str.replace(/<(?:b|strong)(?: [^>])?>(.*?)<\/(?:b|strong)>/ig,function(match, content){
        return "**" + content.trim() + "**";
    });

    // U
    str = str.replace(/<u(?: [^>])?>(.*?)<\/u>/ig,function(match, content){
        return "_" + content.trim() + "_";
    });

    // EM
    str = str.replace(/<(?:i|em)(?: [^>])?>(.*?)<\/(?:i|em)>/ig,function(match, content){
        return "*" + content.trim() + "*";
    });

    // CODE
    str = str.replace(/<code(?: [^>])?>(.*?)<\/code>/ig,function(match, content){
        return "`" + content.trim() + "`";
    });

    // A
    str = str.replace(/<a ([^>]*)>(.*?)<\/a[^>]*>/ig,function(match, params, content){
        var paramMatch = params.match(/href\s*=\s*['"]([^'"]+)['"]/),
            url = paramMatch && paramMatch[1] || "#";

        return "[" + content.trim() + "]" + "(" + url +")";
    });

    // UL, replace with newlines
    str = str.replace(/(<\/(?:ul|ol)>)/gi,"$1-\u0000\u0000--\u0000\u0000-");

    // LI, indent by 2 spaces + *
    str = str.replace(/<li[^>]*>(.*?)<\/?(?:li|ol|ul)[^>]*>/ig,function(match, content){

        content = content.replace(/<[^>]*>/g," ").
                    replace(/\s\s+/g," ").
                    trim();

        if(!content){
            // the tag was empty or only included other tags (<img> and such), nothing to show
            return "";
        }

        // return with the space placeholders
        return "-\u0001\u0001--\u0001\u0001-* " + content + "\n";
    });

    // PRE, indent by 4 spaces
    str = str.replace(/<pre[^>]*>(.*?)<\/pre[^>]*>/ig,function(match, content){
        if(!content){
            return "";
        }

        // remove empty lines before and after
        content = content.replace(/^((?:[ \t]*)\-\u0002\u0002\-)+|((?:\-\u0002\u0002\-[ \t]*))+$/g, "");

        // replace tabs with 4 spaces
        content = content.replace(/\t/g, "    ");

        // replace temp. linebreak placeholders with 4 space placehorlders
        content = content.replace(/\-\u0002\u0002\-([ ]*)/g, function(match, spaces){
            // keep spaces in the beginning of the lines
            spaces = spaces.replace(/ /g, "-\u0001\u0001-");

            return "\n-\u0001\u0001--\u0001\u0001--\u0001\u0001--\u0001\u0001-" + spaces;
        });

        content = content.replace(/</g,"&lt;").replace(/>/g,"&gt;");

        // add prepending 4 spaces
        return "\n-\u0001\u0001--\u0001\u0001--\u0001\u0001--\u0001\u0001-" + content.trim() + "\n\n";
    });

    // remove all remaining html tags
    str = str.replace(/<[^>]*>/g," ");

    // remove duplicate spaces
    str = str.replace(/[ ][ ]+/g," ");

    // remove temp. newlines
    str = str.replace(/-\u0002\u0002-/g," ");

    // restore newlines
    str = str.replace(/-\u0000\u0000-/g,"\n");

    // remove spaces before and after newlines
    str = str.replace(/[ \t]*\n[ \t]*/g,"\n");

    // remove more than 2 newlines in a row
    str = str.replace(/\n\n+/g,"\n\n");

    // restore hidden spaces
    str = str.replace(/-\u0001\u0001-/g," ");

    // decode HTML entities (&lt; and such)
    str = he.decode(str);

    return str.trim();
}
