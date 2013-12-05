# Changelog

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
