# Changelog

## v1.2.2 2014-09-05

Proper handling of data uris as attachments. Attachment `path` property can also be defined as a data uri, not just regular url or file path.

## v1.2.1 2014-08-21

Bumped libmime and mailbuild versions to properly handle filenames with spaces (short ascii only filenames with spaces were left unquoted).

## v1.2.0 2014-08-18

Allow using encoded strings as attachments. Added new property `encoding` which defines the encoding used for a `content` string. If encoding is set, the content value is converted to a Buffer value using the defined encoding before usage. Useful for including binary attachemnts in JSON formatted email objects.

## v1.1.2 2014-08-18

Return deprecatin error for v0.x style configuration

## v1.1.1 2014-07-30

Bumped nodemailer-direct-transport dependency. Updated version includes a bugfix for Stream nodes handling. Important only if use direct-transport with Streams (not file paths or urls) as attachment content.

## v1.1.0 2014-07-29

Added new method `resolveContent()` to get the html/text/attachment content as a String or Buffer.

## v1.0.4 2014-07-23

Bugfix release. HTML node was instered twice if the message consisted of a HTML
content (but no text content) + at least one attachment with CID + at least
one attachment without CID. In this case the HTML node was inserted both to
the root level multipart/mixed section and to the multipart/related sub section

## v1.0.3 2014-07-16

Fixed a bug where Nodemailer crashed if the message content type was multipart/related

## v1.0.2 2014-07-16

Upgraded nodemailer-smtp-transport to 0.1.11. The docs state that for SSL you should use 'secure' option but the underlying smtp-connection module used 'secureConnection' for this purpose. Fixed smpt-connection to match the docs.

## v1.0.1 2014-07-15

Implemented missing #close method that is passed to the underlying transport object. Required by the smtp pool.

## v1.0.0 2014-07-15

Total rewrite. See migration guide here: http://www.andrisreinman.com/nodemailer-v1-0/#migrationguide

## v0.7.1 2014-07-09

  * Upgraded aws-sdk to 2.0.5

## v0.7.0 2014-06-17

  * Bumped version to v0.7.0
  * Fix AWS-SES usage [5b6bc144]
  * Replace current SES with new SES using AWS-SDK (Elanorr) [c79d797a]
  * Updated README.md about Node Email Templates (niftylettuce) [e52bef81]

## v0.6.5 2014-05-15

  * Bumped version to v0.6.5
  * Use tildes instead of carets for dependency listing [5296ce41]
  * Allow clients to set a custom identityString (venables) [5373287d]
  * bugfix (adding "-i" to sendmail command line for each new mail)  by copying this.args (vrodic) [05a8a9a3]
  * update copyright (gdi2290) [3a6cba3a]

## v0.6.4 2014-05-13

  * Bumped version to v0.6.4
  * added npmignore, bumped dependencies [21bddcd9]
  * Add AOL to well-known services (msouce) [da7dd3b7]

## v0.6.3 2014-04-16

  * Bumped version to v0.6.3
  * Upgraded simplesmtp dependency [dd367f59]

## v0.6.2 2014-04-09

  * Bumped version to v0.6.2
  * Added error option to Stub transport [c423acad]
  * Use SVG npm badge (t3chnoboy) [677117b7]
  * add SendCloud to well known services (haio) [43c358e0]
  * High-res build-passing and NPM module badges (sahat) [9fdc37cd]

## v0.6.1 2014-01-26

  * Bumped version to v0.6.1
  * Do not throw on multiple errors from sendmail command [c6e2cd12]
  * Do not require callback for pickup, fixes #238 [93eb3214]
  * Added AWSSecurityToken information to README, fixes #235 [58e921d1]
  * Added Nodemailer logo [06b7d1a8]

## v0.6.0 2013-12-30

  * Bumped version to v0.6.0
  * Allow defining custom transport methods [ec5b48ce]
  * Return messageId with responseObject for all built in transport methods [74445cec]
  * Bumped dependency versions for mailcomposer and readable-stream [9a034c34]
  * Changed pickup argument name to 'directory' [01c3ea53]
  * Added support for IIS pickup directory with PICKUP transport (philipproplesch) [36940b59..360a2878]
  * Applied common styles [9e93a409]
  * Updated readme [c78075e7]

## v0.5.15 2013-12-13

  * bumped version to v0.5.15
  * Updated README, added global options info for setting uo transports [554bb0e5]
  * Resolve public hostname, if resolveHostname property for a transport object is set to `true` [9023a6e1..4c66b819]

## v0.5.14 2013-12-05

  * bumped version to v0.5.14
  * Expose status for direct messages [f0312df6]
  * Allow to skip the X-Mailer header if xMailer value is set to 'false' [f2c20a68]

## v0.5.13 2013-12-03

  * bumped version to v0.5.13
  * Use the name property from the transport object to use for the domain part of message-id values (1598eee9)

## v0.5.12 2013-12-02

  * bumped version to v0.5.12
  * Expose transport method and transport module version if available [a495106e]
  * Added 'he' module instead of using custom html entity decoding [c197d102]
  * Added xMailer property for transport configuration object to override X-Mailer value [e8733a61]
  * Updated README, added description for 'mail' method [e1f5f3a6]

## v0.5.11 2013-11-28

  * bumped version to v0.5.11
  * Updated mailcomposer version. Replaces ent with he [6a45b790e]

## v0.5.10 2013-11-26

  * bumped version to v0.5.10
  * added shorthand function mail() for direct transport type [88129bd7]
  * minor tweaks and typo fixes [f797409e..ceac0ca4]

## v0.5.9 2013-11-25

  * bumped version to v0.5.9
  * Update for 'direct' handling [77b84e2f]
  * do not require callback to be provided for 'direct' type [ec51c79f]

## v0.5.8 2013-11-22

  * bumped version to v0.5.8
  * Added support for 'direct' transport [826f226d..0dbbcbbc]

## v0.5.7 2013-11-18

  * bumped version to v0.5.7
  * Replace \r\n by \n in Sendmail transport (rolftimmermans) [fed2089e..616ec90c]
    A lot of sendmail implementations choke on \r\n newlines and require \n
    This commit addresses this by transforming all \r\n sequences passed to
    the sendmail command with \n

## v0.5.6 2013-11-15

  * bumped version to v0.5.6
  * Upgraded mailcomposer dependency to 0.2.4 [e5ff9c40]
  * Removed noCR option [e810d1b8]
  * Update wellknown.js, added FastMail (k-j-kleist) [cf930f6d]

## v0.5.5 2013-10-30

  * bumped version to v0.5.5
  * Updated mailcomposer dependnecy version to 0.2.3
  * Remove legacy code - node v0.4 is not supported anymore anyway
  * Use hostname (autodetected or from the options.name property) for Message-Id instead of "Nodemailer" (helps a bit when messages are identified as spam)
  * Added maxMessages info to README

## v0.5.4 2013-10-29

  * bumped version to v0.5.4
  * added "use strict" statements
  * Added DSN info to README
  * add support for QQ enterprise email (coderhaoxin)
  * Add a Bitdeli Badge to README
  * DSN options Passthrought into simplesmtp. (irvinzz)

## v0.5.3 2013-10-03

  * bumped version v0.5.3
  * Using a stub transport to prevent sendmail from being called during a test. (jsdevel)
  * closes #78: sendmail transport does not work correctly on Unix machines. (jsdevel)
  * Updated PaaS Support list to include Modulus. (fiveisprime)
  * Translate self closing break tags to newline (kosmasgiannis)
  * fix typos (aeosynth)

## v0.5.2 2013-07-25

  * bumped version v0.5.2
  * Merge pull request #177 from MrSwitch/master
    Fixing Amazon SES, fatal error caused by bad connection
