
/* Copyright (c) 2017 Hillar Aarelaid
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

 /*

# wise source plugin to queri evebox API ver 1 for suricata alerts

* wise :: https://github.com/aol/moloch/tree/master/capture/plugins/wiseService
* evebox :: https://github.com/jasonish/evebox https://evebox.org/

## wise.ini
[suricata]
evBox=https://evebox.blah
### optional tags
mustHaveTags=escalated
mustNotHaveTags=archived;deleted;

*/

'use strict';

var wiseSource     = require('./wiseSource.js')
  , util           = require('util')
  , request        = require('request')
  ;

var source;

function SuricataSource (api, section) {
  var self = this;
  SuricataSource.super_.call(this, api, section);
  this.count = 0;
  this.alerts = 0;
  this.errors = 0;
  this.evBox = this.api.getConfig("suricata", "evBox");
  if (this.evBox === undefined) {
    console.log(this.section, "- No evebox host defined");
    return;
  }
  this.tags = "";
  // see https://github.com/jasonish/evebox/blob/dbfa3ce1348fc8186bf36fbfda85a7966949e833/webapp/src/app/elasticsearch.service.ts#L288
  var mustHaveTags = this.api.getConfig("suricata", "mustHaveTags");
  if (!this.mustHaveTags === undefined) {
    mustHaveTags.split(";").forEach(function(tag){
      this.tags += tag.trim() + ","
    });
  }
  var mustNotHaveTags = this.api.getConfig("suricata", "mustNotHaveTags");
  if (!mustNotHaveTags === undefined) {
    mustNotHaveTags.split(";").forEach(function(tag){
      this.tags += "-" +tag.trim() + ","
    });
  }
  // test evebox connection
  var options = {
    url: this.evBox+"/api/1/version",
    method: 'GET',
    json: true
  };
  var req = request(options, function(err, im, results) {
    if (err || im.statusCode != 200 || results === undefined) {
      console.log(self.section, "- Error for request:\n", options, "\n", im, "\nresults:\n", results);
      return;
    }
    console.log(self.evBox,"/api/1/version returned",results)
    // TODO move it to https://github.com/aol/moloch/blob/master/capture/plugins/wiseService/wiseSource.js#L39
    self.excludeTuples = [];
    self.api.addSource("suricata", self);
    self.signatureField = self.api.addField("field:suricata.signature;db:suricata.signature-term;kind:termfield;friendly:Signature;help:Suricata Alert Signature;count:true");
    self.categoryField = self.api.addField("field:suricata.category;db:suricata.category-term;kind:termfield;friendly:Category;help:Suricata Alert Category;count:true");
    self.severityField = self.api.addField("field:suricata.severity;db:suricata.severity;kind:integer;friendly:Severity;help:Suricata Alert Severity;count:true");
    // print stats
    setInterval(function(){
      console.log("Suricata: checks:",self.count,"alerts:", self.alerts, "query errors:", self.errors);
    }, 8*1000);
  }).on('error', function (err) {
    console.log(self.section, "- ERROR",err);
    return;
  });

}

util.inherits(SuricataSource, wiseSource);

SuricataSource.prototype.getTuple = function(tuple, cb) {

  this.count += 1;
  // [ '1490640063', 'tcp', '10.0.2.2', '57000', '10.0.2.15', '22' ]
  // wait for node upgrade ...
  // var [ timestamp, protos, src_ip, src_port, dest_ip, dest_port ] = tuple.split(";");
  var bites = tuple.split(";");
  var timestamp = bites[0];
  //var protos = bites[1].split(",");
  var src_ip = bites[2];
  var src_port = bites[3];
  var dest_ip = bites[4];
  var dest_port = bites[5];

  // build evebox query
  // see :
  // * https://github.com/jasonish/evebox/blob/master/elasticsearch/alertqueryservice.go
  // * https://github.com/jasonish/evebox/blob/59472e3dd9449b95bf78dc08e2b7f1a88834ed70/core/eventservice.go#L46
  // waiting for minTs and maxTs ;)

  var timeRange = Math.floor(Date.now()/1000) - timestamp;
  // moloch and suricata sometimes do set "oposite" src and dest
  // so we need query (src and dest) or (dest and src)
  var queryString = "(src_ip:%22"+ src_ip +"%22%20AND%20" +
                    "src_port:%22"+ src_port +"%22%20AND%20" +
                    "dest_ip:%22"+ dest_ip +"%22%20AND%20" +
                    "dest_port:%22"+ dest_port +"%22)OR"+
                    "(src_ip:%22"+ dest_ip +"%22%20AND%20" +
                    "src_port:%22"+ dest_port +"%22%20AND%20" +
                    "dest_ip:%22"+ src_ip +"%22%20AND%20" +
                    "dest_port:%22"+ src_port +"%22)"

  var url = this.evBox+"/api/1/alerts?tags=" +  this.tags +
                                     "&timeRange=" + timeRange + "s" +
                                     "&queryString=" + queryString
  if (this.api.debug > 2) {
    console.log(url)
  }
  var options = {
    url: url,
    method: 'GET',
    json: true
  };
  var self = this;
  var req = request(options, function(err, im, results) {
    if (err || im.statusCode != 200 || results === undefined) {
      this.errors += 1;
      if (self.api.debug > 1) {
      console.log(self.section, "- Error for request:\n", options, "\n", im, "\nresults:\n", results);
      }
      return cb(undefined, undefined);
    }
    self.alerts += 1;
    if (self.api.debug > 3) {
      console.dir(results)
      /*
      {
          "alerts": [{
              "count": 1,
              "event": {
                  "_id": "95983add-13f7-11e7-afde-02ed55e681b9",
                  "_index": "suricata-2017.03.28",
                  "_score": null,
                  "_source": {
                      "@timestamp": "2017-03-28T20:46:13.946Z",
                      "alert": {
                          "action": "allowed",
                          "category": "Potentially Bad Traffic",
                          "gid": 1,
                          "rev": 7,
                          "severity": 2,
                          "signature": "GPL ATTACK_RESPONSE id check returned root",
                          "signature_id": 2100498
                      },
                      "dest_ip": "10.0.2.15",
                      "dest_port": 58542,
                      "event_type": "alert",
                      "flow_id": 1308387892870536,
                      "geoip": {
                          "continent_code": "EU",
                          "coordinates": [9.491, 51.2993],
                          "country_code2": "DE",
                          "country_name": "Germany",
                          "ip": "82.165.177.154",
                          "latitude": 51.2993,
                          "longitude": 9.491
                      },
                      "host": "suricata",
                      "in_iface": "enp0s3",
                      "proto": "TCP",
                      "src_ip": "82.165.177.154",
                      "src_port": 80,
                      "tags": [],
                      "timestamp": "2017-03-28T20:46:13.946584+0000"
                  },
                  "_type": "log",
                  "sort": [1490733973946]
              },
              "maxTs": "2017-03-28T20:46:13.946584+0000",
              "minTs": "2017-03-28T20:46:13.946584+0000",
              "escalatedCount": 0
          }]
      }
      */
    }
    if (results['alerts'] === undefined || results['alerts'].length == 0) {
      return cb(undefined, undefined);
    } else {
      // TODO how to send more than one alert per tuple ?
      if (results['alerts'].length > 1) {
        console.log("TODO: more than one alert, going to skip ", results['alerts'].length)
      }
      results['alerts'].forEach(function(alert){
        var wiseResult;
        var signature = alert['event']['_source']['alert']['signature'];
        var category = alert['event']['_source']['alert']['category'];
        var severity = alert['event']['_source']['alert']['severity'];
        var args = [self.signatureField, signature, self.categoryField, category, self.severityField,""+severity];
        wiseResult = {num: args.length/2, buffer: wiseSource.encode.apply(null, args)};
        return cb(null, wiseResult);
      });
      return ;

    }
  }).on('error', function (err) {
    console.log(self.section, "- ERROR",err);
    return cb(undefined, undefined);
  });
};

exports.initSource = function(api) {
  var source = new SuricataSource(api, "suricata");
};
