# Changelog

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
