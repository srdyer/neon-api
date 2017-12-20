var neo = require("neo.node.js");

var localNode = neo.node('http://localhost:10332');

localNode.getBlockCount().then(function (result) {
    console.log('Current block height: ' + result);
	});

localNode.getLastBlockHash().then(function (result) {
    console.log('Hash of last block: ' + result);
	});

var options = {
    baseUrl: 'http://www.antchain.org/api/v1/',
    transform: neo.transforms.antchain
	};

neo.antChain(options).getAddressValue('AQVh2pG732YvtNaxEGkQUei3YA4cvo7d2i').then(function (addressValue) {
    console.log(addressValue.antShare.value);
    console.log(addressValue.antCoin.value);
	});