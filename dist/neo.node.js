'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var axios = _interopDefault(require('axios'));

let protocolClient;

let registry = {
    registerProtocolClient: registerProtocolClient
};


function registerProtocolClient (client) {
    protocolClient = client;
}

function getProtocolClient () {
    return protocolClient;
}

function serviceOptions(service, serviceName, initObj) {

    if (typeof initObj === 'string') {
        initObj = { baseUrl: initObj};
    }
    else if (typeof initObj !== 'object') {
        initObj = {};
    }

    service.serviceName = serviceName;
    service.serviceBaseUrl = initObj.baseUrl || '';
    service.servicePollInterval = initObj.poll;

    service.baseUrl = baseUrl;
    service.protocolClient = protocolClient;
    service.poll = poll;

    function baseUrl (val) {

        if (!val) {
            return this.serviceBaseUrl;
        }

        this.serviceBaseUrl = val;

        return this;
    }

    function protocolClient (val) {

        if (!val) {
            return this.serviceProtocolClient || getProtocolClient();
        }

        this.serviceProtocolClient = val;

        return this;
    }

    function poll (val) {

        if (!val) {
            return this.servicePollInterval;
        }

        this.servicePollInterval = val;

        return this;
    }
}

function IntervalUtil (options) {

    var _defaults = {
        interval: 25 * 1000,            //25 Seconds
        errorInterval: 5 * 60 * 1000    //5 Minutes
    };

    var _options;
    var _intervalFunction;
    var _intervalId;
    var _running;

    if (typeof options === 'number') {

        options = Math.max(1000, options); //1 second minimum

        options = {interval: options};
    }

    _options = Object.assign({}, _defaults, options || {});

    //function noop () {}

    function start (intervalFunction) {

        if (_running) {
            stop();
        }

        _intervalFunction = intervalFunction;
        _running = true;

        _startInterval(_options.interval);
    }

    function stop () {
        _running = false;
        clearTimeout(_intervalId);
    }

    function isRunning () {
        return _running;
    }

    function _startInterval (delay) {

        _intervalId = setTimeout(function () {
            _intervalFunction();
        }, delay);
    }

    this.stop = stop;
    this.start = start;
    this.isRunning = isRunning;
}

function RpcService () {

    this.$post = $post;

    function $post (rpcMethod, rpcParams) {
        return rpcRequest(this, 'POST', rpcMethod, rpcParams);
    }

    function rpcRequest (service, method, rpcMethod, rpcParams) {

        if (!rpcMethod) {
            throw new Error('You must configure the rpc method');
        }

        var data = { jsonrpc: '2.0', id: 1 };

        data.method = rpcMethod;
        data.params = rpcParams || [];

        var options = {};

        options.url = service.baseUrl();
        options.data = data;
        options.method = method;

        options.transformResponse = function (response) {
            return response.data.result;
        };

        options.transformResponseError = function (response) {
            return response.data.error;
        };

        return makeServiceRequest(service, options);
    }
}

function IpcService () {

    this.$send = $send;

    function $send (method, params) {
        return ipcRequest(this, method, params);
    }

    function ipcRequest (service, method, params) {

        if (!method) {
            throw new Error('You must configure the ipc method');
        }

        let data = {
            method: method,
            params: params || []
        };

        let options = {};

        options.data = data;

        return makeServiceRequest(service, options);
    }
}

let factory = ServiceFactory();

function ServiceFactory () {

    function createRcpService (options) {
        let inst = new RpcService();

        serviceOptions(inst, 'node', options);

        return inst;
    }

    function createIpcService (options) {
        let inst = new IpcService();

        serviceOptions(inst, 'node', options);

        return inst;
    }

    function createRestService (options) {
        let inst = new RestService();

        serviceOptions(inst, 'node', options);

        return inst;
    }

    return {
        createRcpService: createRcpService,
        createIpcService: createIpcService,
        createRestService: createRestService
    };
}

let service = Service();

service.factory = factory;

function Service () {

    // All requests under the same policy will get coalesced.
    function PollingPolicy (options) {

        this.options = options;
        this.stopAll = function () {}; //set by PollRunner
        this.startAll = function () {}; //set by PollRunner

        this._interval = function () {};
        this._requests = [];
    }

    //When Batch of methods complete
    PollingPolicy.prototype.onInterval = onInterval;
    PollingPolicy.prototype.run = run;

    function onInterval (fn) {

        if (typeof fn !== 'function') {
            throw new Error('onInterval(fn) - "fn" must be of type "function"');
        }

        this._interval = fn;
    }

    function run (method) {
        this._requests.push(method);
    }

    function createPollingPolicy (options) {
        return new PollingPolicy(options);
    }

    function isPollingPolicy (obj) {
        return obj instanceof PollingPolicy;
    }

    //number, optionsObj or PollPolicy
    function getPollRunner (obj) {

        if(obj instanceof PollingPolicy) {
            if (!obj._pollRunner) {
                obj._pollRunner = new PollRunner(obj);
            }

            return obj._pollRunner;
        }

        return new PollRunner(new PollingPolicy(obj));
    }

    return {
        createPollingPolicy: createPollingPolicy,
        isPollingPolicy: isPollingPolicy,
        getPollRunner: getPollRunner
    };
}

function PollRunner (policy) {

    let intervalUtil = new IntervalUtil(policy.options);
    let _isPaused = false;
    let _isPolling = false;
    
    this.isPolling = isPolling;
    this.addRequest = addRequest;
    this.pause = pause;
    this.play = play;

    policy.stopAll = pause;
    policy.startAll = play;

    function isPolling() {
        return _isPolling || intervalUtil.isRunning();
    }

    function addRequest (request) {
        policy._requests.push(request);

        return this;
    }

    function pause() {
        _isPaused = true;

        intervalUtil.stop();
    }

    function play() {
        if (_isPaused) {
            _isPaused = false;

            intervalUtil.start(runAll);
        }
    }

    setTimeout(runAll, 0);

    function runAll () {
        let count = policy._requests.length;

        _isPolling = true;

        policy._requests.forEach(function (request) {
            request().then(complete).catch(complete);
        });

        function complete () {
            --count;

            if (count === 0) {
                policy._interval();

                _isPolling = false;

                if (!_isPaused) {
                    intervalUtil.start(runAll);
                }
            }
        }
    }
}

function makeServiceRequest (restService, httpOptions) {

    return _wrapPromise(function (resolve, reject, notify) {

        let ctx = prepareContext();

        ctx.successFunction = resolve;
        ctx.errorFunction = reject;
        ctx.notifyFunction = notify;
        ctx.transformResponse = httpOptions.transformResponse || noop;
        ctx.transformResponseError = httpOptions.transformResponseError || noop;

        let client = restService.protocolClient();

        let options = client.buildRequestOptions(httpOptions);

        let poll = restService.poll();

        if (poll) {
            let pollRunner = service.getPollRunner(poll).addRequest(function () {
                return _makeServiceRequest(client, options, ctx);
            });

            ctx.stopPolling = pollRunner.pause;
            ctx.isPolling = pollRunner.isPolling;
        }
        else {
            _makeServiceRequest(client, options, ctx);
        }
    });
}

function noop () {}

//Only top-level Promise has notify. This is intentional as then().notify() does not make any sense.
//  Notify keeps the chain open indefinitely and can be called repeatedly.
//  Once Then is called, the promise chain is considered resolved and marked for cleanup. Notify can never be called after a then.
function _wrapPromise (callback) {

    let promise = new Promise(function (resolve, reject) {
        callback(resolve, reject, handleNotify);
    });

    promise._notify = noop;
    promise.notify = notify;

    function notify (fn) {

        if (promise._notify === noop) {
            promise._notify = fn;
        }
        else {
            //Support chaining notify calls: notify().notify()
            let chainNotify = promise._notify;

            promise._notify = function (result) {
                return fn(chainNotify(result));
            };
        }

        return this;
    }

    function handleNotify (result) {
        promise._notify(result);
    }

    return promise;
}

function prepareContext() {
    let ctx = {};

    ctx.stopPolling = noop;
    ctx.isPolling = function () { return false; };

    return ctx;
}

function _makeServiceRequest (client, options, ctx) {

    let promise = client.invoke(options);

    promise.catch(function (response) {
        ctx.errorFunction(response);
    });

    promise = promise.then(function (response) {

        let data = ctx.transformResponse(response);

        if (!data) {
            let error = ctx.transformResponseError(response);

            if (error) {
                ctx.errorFunction(error, response);
                if (ctx.isPolling()) {
                    ctx.stopPolling();
                }

                return;
            }
        }

        if (ctx.isPolling()) {
            ctx.notifyFunction(data, response);
        }
        else {
            ctx.successFunction(data, response);
        }

    });

    return promise;

}

function rest (options) {
    let inst = new RestService();

    serviceOptions(inst, 'rest', options);

    return inst;
}

function RestService () {

    this.$post = $post;
    this.$get = $get;
    this.$put = $put;
    this.$delete = $delete;

    function $post (url, data, options, queryParams) {
        return httpRequest(this, url, 'POST', data, options, queryParams);
    }

    function $get (url, queryParams, options) {
        return httpRequest(this, url, 'GET', null, options, queryParams);
    }

    function $put (url, data, options, queryParams) {
        return httpRequest(this, url, 'PUT', data, options, queryParams);
    }

    function $delete (url, queryParams, options) {
        return httpRequest(this, url, 'DELETE', null, options, queryParams);
    }

    function httpRequest (service, url, method, data, options, queryParams) {

        if (!method || !url) {
            throw new Error('You must configure at least the http method and url');
        }

        options = options || {};

        if (service.baseUrl() !== undefined) {
            url = service.baseUrl() + url;
        }

        options.url = url;
        options.body = data;
        options.method = method;
        options.queryParams = queryParams;

        if (!options.hasOwnProperty('transformResponse')) {
            options.transformResponse = function (response) {
                return response.data;
            };
        }

        if (!options.hasOwnProperty('transformResponseError')) {
            options.transformResponseError = function (response) {
                return response.data;
            };
        }

        return makeServiceRequest(service, options);
    }
}

function antChain(options) {
    let inst = new RestService();

    serviceOptions(inst, 'antChain', options);

    //Block
    inst.getBlockByHash = getBlockByHash;
    inst.getBlockByHeight = getBlockByHeight;
    inst.getCurrentBlock = getCurrentBlock;
    inst.getCurrentBlockHeight = getCurrentBlockHeight;

    //Address
    inst.getAddressBalance = getAddressBalance;
    inst.getUnspentCoinsByAddress = getUnspentCoinsByAddress;

    //Tx
    inst.getTransactionByTxid = getTransactionByTxid;

    return inst;
}

function getAddressBalance (address) {
    return this.$get('address/get_value/' + address);
}

function getUnspentCoinsByAddress (address) {
    return this.$get('address/get_unspent/' + address);
}

function getBlockByHash (blockhash) {
    return this.$get('block/get_block/' + blockhash);
}

function getBlockByHeight (height) {
    return this.$get('block/get_block/' + height);
}

function getCurrentBlock () {
    return this.$get('block/get_current_block');
}

function getCurrentBlockHeight () {
    return this.$get('block/get_current_height');
}

function getTransactionByTxid (txid) {
    return this.$get('tx/get_tx/' + txid);
}

function antChainXyz(options) {
    var inst = new RestService();

    serviceOptions(inst, 'antChainXyz', options);

    inst.getAddressBalance = getAddressBalance$1;
    inst.getAssetTransactionsByAddress = getAssetTransactionsByAddress;

    return inst;
}

function getAddressBalance$1 (address) {
    return this.$get('address/info/' + address);
}

function getAssetTransactionsByAddress (address) {
    return this.$get('address/utxo/' + address);
}

function neoScan(options) {
    var inst = new RestService();

    serviceOptions(inst, 'neoScan', options);

    inst.getCurrentBlockHeight = getCurrentBlockHeight$1;

    return inst;
}

function getCurrentBlockHeight$1 () {
    return this.$get('get_height');
}

function neon(options) {
    var inst = new RestService();

    serviceOptions(inst, 'neon', options);

    inst.getCurrentBlockHeight = getCurrentBlockHeight$2;
    inst.getAddressBalance = getAddressBalance$2;
    inst.getAssetTransactionsByAddress = getAssetTransactionsByAddress$1;
    inst.getTransactionByTxid = getTransactionByTxid$1;

    return inst;
}

function getCurrentBlockHeight$2 () {
    return this.$get('block/height', null, { transformResponse: transformResponse });

    function transformResponse (response) {
        return {
            height: response.data && response.data.block_height
        };
    }
}

function getAddressBalance$2 (address) {
    return this.$get('address/balance/' + address);
}

function getAssetTransactionsByAddress$1 (address) {
    return this.$get('address/history/' + address);
}

function getTransactionByTxid$1 (txid) {
    return this.$get('transaction/' + txid);
}

function node(options) {
    var inst = new RpcService();

    serviceOptions(inst, 'node', options);

    //Asset
    inst.getBalance = getBalance;

    //Block
    inst.getLastBlockHash = getLastBlockHash;
    inst.getBlockByHeight = getBlockByHeight$1;
    inst.getBlockCount = getBlockCount;
    inst.getBlockHashByHeight = getBlockHashByHeight;

    //Net
    inst.getConnectionCount = getConnectionCount;

    //Tx
    inst.getRawMemPool = getRawMemPool;
    inst.getRawTransaction = getRawTransaction;
    inst.getTxOut = getTxOut;

    return inst;
}

function getBalance (assetId) {
    return this.$post('getbalance', [assetId]);
}

function getLastBlockHash () {
    return this.$post('getbestblockhash', []);
}

function getBlockByHeight$1 (height, verbose) {
    return this.$post('getblock', [height, verbose ? 1 : 0]);
}

function getBlockCount () {
    return this.$post('getblockcount', []);
}

function getBlockHashByHeight (height) {
    return this.$post('getblockhash', [height]);
}

function getConnectionCount () {
    return this.$post('getconnectioncount', []);
}

function getRawMemPool () {
    return this.$post('getrawmempool', []);
}

function getRawTransaction (txId, verbose) {
    return this.$post('getrawtransaction', [txId, verbose ? 1 : 0]);
}

function getTxOut (txId, index) {
    return this.$post('gettxout', [txId, index]);
}

//AXIOS workaround - process.env.NODE_ENV
if (typeof process === 'undefined' && !window.process) {
    window.process = {env: {}};
}

let axiosClient = AxiosClient();

function AxiosClient (){

    function invoke (restOptions) {
        return axios(restOptions);
    }

    function serialize (obj) {
        return obj && Object.keys(obj).map(function (key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]);
        }).join('&');
    }

    function filterKeys (srcOptions, keys) {
        return keys.reduce(function (result, k) {
            if (srcOptions[k]) {
                result[k] = srcOptions[k];
            }

            return result;
        }, {});
    }

    function buildRequestOptions (options) {

        //Build Url with queryParams
        let paramStr = options.queryParams && serialize(options.queryParams);

        if(paramStr) {
            options.url = options.url + '?' + paramStr;
        }

        // Don't allow any undefined values into Fetch Options
        options = filterKeys(options, ['method', 'url', 'params', 'body', 'data', 'cache', 'headers']);

        options.headers = {};
        
        options.headers['Accept'] = 'application/json';
        options.headers['Content-Type'] = 'application/json';

        if (options.body) {
            options.body = JSON.stringify(options.body);
        }

        if (options.data) {
            options.data = JSON.stringify(options.data);
        }

        return options;
    }

    return {
        invoke: invoke,
        buildRequestOptions: buildRequestOptions
    };
}

registerProtocolClient(axiosClient);

exports.antChain = antChain;
exports.antChainXyz = antChainXyz;
exports.neoScan = neoScan;
exports.neon = neon;
exports.node = node;
exports.rest = rest;
exports.registry = registry;
exports.service = service;
