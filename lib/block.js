/**
 * Abstract graphical wrapper for any audio-lab plugin.
 * Provides default block view and behaviour.
 */


var Emitter = require('events');
var domify = require('domify');
var hasDom = require('has-dom');
var Dialog = require('popoff');
var Draggable = require('draggy');
var Resizable = require('resizable');
var Connection = require('./connection');
var JSON = require('json3');
var offset = require('mucss/offset');
var delegate = require('emmy/delegate');
var on = require('emmy/on');
var off = require('emmy/off');
var once = require('emmy/once');
var css = require('mucss/css');
var extend = require('xtend/mutable');
var win = require('global/window');
var selection = require('mucss/selection');
var q = require('queried');
var defineState = require('define-state');
var getUid = require('get-uid');
var autosize = require('autosize');
var dragon = require('dragon-names');
var setCaret = require('caret-position2/set');
var Stream = require('stream');


/**
 * Create an empty block
 *
 * @constructor
 */
class Block extends Emitter {
	constructor (plugin, options) {
		super();

		var self = this;

		//create unique id
		self.id = getUid();

		//take over passed options (probably redefine id)
		extend(self, options);

		//prepare plugin options
		var pluginOptions = options.pluginOptions || {};

		//create plugin instance
		self.Plugin = plugin;
		self.plugin = new plugin(pluginOptions);

		if (self.plugin.numberOfInputs !== undefined) {
			self.numberOfInputs = self.plugin.numberOfInputs;
		}
		if (self.plugin.numberOfOutputs !== undefined) {
			self.numberOfOutputs = self.plugin.numberOfOutputs;
		}

		//create DOM representation
		self.createElement();

		//reflect state
		defineState(self, 'state', self.state);
		self.state = 'loading';

		//keep outputs set
		self.outputs = new Set();
		self.inputs = new Set();

		//save instance on element
		self.element.block = self;

		//update position
		css(self.element, {
			top: self.top,
			left: self.left
		});

		//rerender
		self.update();

		//should be done in specific class
		// self.state = 'ready';
	}


	/**
	 * Construct DOM representation
	 */
	createElement () {
		var self = this;

		if (!hasDom) return;

		var pluginTitle = self.Plugin.title || self.Plugin.name;
		var thumbnail = self.Plugin.thumbnail || pluginTitle[0];

		self.element = domify(`
			<div class="block block-${ self.constructor.name.toLowerCase() }"
				data-block="${ self.id }"
				tabindex="1"
				title="${ self.constructor.name.toLowerCase() }">
				<div class="block-thumbnail" data-block-thumbnail data-block-handle>
					${ thumbnail }
				</div>
				<textarea class="block-label" data-block-label rows="1">${ self.label || pluginTitle || dragon.allRandom() }</textarea>
				<div class="block-content" data-block-content></div>
				<div class="block-out" data-block-output></div>
				<div class="block-in" data-block-input></div>
			</div>
		`);


		//get label element, autosize it
		self.label = q('[data-block-label]', self.element);
		on(self.label, 'change', function () {
			self.emit('change');
		});

		//select all by focus
		on(self.label, 'click', function () {
			//don’t select unless it is not selected before
			if (document.activeElement !== self.label) {
				setCaret(self.label, 0, 9999);
			}
		});

		on(self.label, 'keydown', function (e) {
			//close self by pressing enter
			if (e.ctrlKey && e.which === 13) {
				self.element.focus();
				e.stopPropagation();
			}
		});

		autosize(self.label);


		//show dialog on click
		self.content = q('[data-block-content]', self.element);


		//place content to a dialog
		self.element.removeChild(self.content);
		self.dialog = new Dialog(self.content, {
			escapable: true,
			closable: true
		});

		//make self draggable, load initial position btw
		self.draggable = new Draggable(self.content, {
			cancel: ['textarea', '.CodeMirror']
		});

		//make content resizable, load initial size btw
		self.resizable = new Resizable(self.content, {
		});

		//if plugin instance provides specific element, thein insert it into content
		if (self.plugin.createElement) {
			//create plugin-specific control
			self.content.appendChild(self.plugin.createElement(self.content));

			//draggable may contain codemirror, so update cancel elements
			self.draggable.update();

			//show dialog on dblclick
			on(self.element, 'dblclick', function (e) {
				self.show();
			});
		}


		self.thumbnail = q('[data-block-thumbnail]', self.element);

		//focus on click
		on(self.element, 'mousedown.' + self.id, function () {
			self.element.focus();
		});

		//handle keypresses
		on(self.element, 'keydown.' + self.id, function (e) {
			//ignore events from the inner elements
			if (document.activeElement !== self.element) {
				return;
			}

			//unfocus by escape
			if (e.which === 27) {
				self.element.blur();
			}

			//change volume by arrow
			//move by ctrl+arrow
			if (e.which === 38 || e.which === 40 || e.which === 37 || e.which === 39) {

			}

			//show dialog by enter
			// if (e.which === 13) {
			// 	self.show();
			// }
		});

		//create new connection
		delegate(self.element, 'mousedown.' + self.id, '[data-block-output]', function (e) {
			self.createConnection();
		});

		//forward plugin change event
		self.plugin.on('change', function () {
			self.emit('change');
		});

		return self;
	};


	/**
	 * Destruct self
	 */
	destroy () {
		var self = this;

		//close dialog first
		self.dialog.hide();

		//delete connections
		self.outputs.forEach(function (conn) {
			conn.destroy();
		});
		self.inputs.forEach(function (conn) {
			conn.destroy();
		});

		off(self.element, '.' + self.id);

		//clear reference
		self.element.block = null;
		self.element = null;
	};


	/**
	 * Reveal in DOM settings dialog
	 */
	show () {
		var self = this;

		if (!hasDom) return self;

		self.dialog.show();
		self.dialog.element.focus();

		self.emit('show');
		return self;
	};

	/**
	 * Remove from DOM, go underground
	 */
	hide () {
		var self = this;

		if (!hasDom) return self;

		self.dialog.hide();

		self.emit('hide');
		return self;
	};

	/**
	 * Update node size, position and connections
	 *
	 * @return {Block} Return self
	 */
	update () {
		var self = this;

		//check need to hide input/output
		if (self.numberOfInputs > self.inputs.size) {
			self.element.setAttribute('data-block-potential-target', true);
			// self.element.classList.add('block-potential-target');
		} else {
			self.element.removeAttribute('data-block-potential-target');
			// self.element.classList.remove('block-potential-target');
		}
		if (self.numberOfOutputs > self.outputs.size) {
			self.element.setAttribute('data-block-potential-source', true);
			self.element.classList.add('block-potential-source');
		} else {
			self.element.removeAttribute('data-block-potential-source');
			self.element.classList.remove('block-potential-source');
		}

		autosize.update(self.label);

		self.emit('update');
		return self;
	};



	/**
	 * Connect block to another block
	 *
	 * @param {Block} block Target block to connect.
	 *
	 * @return {Block} Return self
	 */
	connect (block) {
		var self = this;

		//ignore new connection if bad number of inputs
		if (self.outputs.size >= self.numberOfOutputs) return self;
		if (block.inputs.size >= block.numberOfInputs) return self;

		//create connection
		var connection = self.createConnection(block);

		//ensure connection event - connection may trigger `connected` in constructor
		self.emit('connect');

		return self;
	};

	/** Create connection */
	createConnection (to) {
		var self = this;

		var connection = new Connection(self, to);

		on(connection, 'connected', function () {
			self.emit('connect');
		});

		on(connection, 'destroy', function () {
			self.emit('disconnect');
		});

		return connection;
	};

	/**
	 * Disconnect node from other block
	 *
	 * @return {Block} Return self
	 */
	disconnect (target) {
		var self = this;

		self.plugin.unpipe(target.plugin);

		self.outputs.forEach(function (conn) {
			//find connection where in = self, out = to
			//or every connection, if no target passed
			if (!target || conn.to === target) {
				conn.destroy();
			}
		});

		self.update();
		return self;
	};


	/**
	 * Represent instance as JSON
	 */
	toJSON () {
		var self = this;

		var data = {
			id: self.id,

			//name to recover
			label: self.label.value,

			//position
			top: self.element.offsetTop,
			left: self.element.offsetLeft,

			//plugin to recreate
			plugin: self.Plugin.title || self.Plugin.name,
			pluginOptions: self.plugin.toJSON && self.plugin.toJSON() || {},

			//connections to other blocks
			outputs: []
		};

		//connections
		self.outputs.forEach(function (conn) {
			data.outputs.push(conn.to.id);
		});

		return data;
	};
}


var proto = Block.prototype;


/** Class name for storage */
proto.className = 'Block';


/**
 * Block states
 */
proto.state = {
	//loading node/source
	loading: {
		before: function () {
			var self = this;

			self.element.classList.add('block-loading');
		},

		after: function () {
			var self = this;

			self.element.classList.remove('block-loading');
		}
	},

	ready: {

	},

	//hangling connection
	connecting: {
		before: function () {
			var self = this;
			self.element.classList.add('block-connecting');

			//highlight potential targets
			q.all('[data-block-potential-target]', self.container).forEach(function (el) {
				el.classList.add('block-potential-target');
			});

			//unhighlight potential sources
			q.all('[data-block-potential-source]', self.container).forEach(function (el) {
				el.classList.remove('block-potential-source');
			});
		},
		after: function () {
			var self = this;
			self.element.classList.remove('block-connecting');

			//unhighlight potential targets
			q.all('[data-block-potential-target]', self.container).forEach(function (el) {
				el.classList.remove('block-potential-target');
			});

			//highlight potential sources
			q.all('[data-block-potential-source]', self.container).forEach(function (el) {
				el.classList.add('block-potential-source');
			});
		}
	},

	playing: {

	},

	//unable to load stream etc
	error: {
		before: function () {
			var self = this;
			self.element.classList.add('block-error');
		},

		after: function () {
			var self = this;
			self.element.classList.remove('block-error');
		}
	}
};


/** Number of outputs/inputs */
proto.numberOfOutputs = 1;
proto.numberOfInputs = 1;


/** A name to use for a block */
proto.label = '';


module.exports = Block;