/**
 * Generator is a simpliest readable stream.
 */

import { Readable } from 'stream';
import extend from 'xtend/mutable';


/**
 * @class Generator
 */
class Generator extends Readable {
	constructor (opts) {
		super();

		var self = this;

		if (typeof opts === 'function') {
			self.generate = opts;
		}
		//take over options
		else {
			extend(self, opts);
		}


		//current item number
		self.count = 0;
	}


	/** Generate chunk */
	_generate () {
		var self = this;

		var chunk = new Buffer(self.blockSize * 4);

		var t = self.count / self.rate;

		for (var i = 0; i < self.blockSize; i++) {
			chunk.writeFloatLE(self.generate(t + i / self.rate), i*4);
		}

		self.count += self.blockSize;

		return chunk;
	}


	/**
	 * Read is called each time the connected block
	 * is ready to eat some more generated data.
	 * So feed it till consumer is full.
	 *
	 * @param {Number} size Number of bytes to generate
	 */
	_read (size) {
		var self = this;

		//send the chunk till possible
		while (self.push(self._generate())) {
		}
	}


	/**
	 * User generator method, supposed to be overridden
	 * @param {number} time current time
	 * @return {number} [-1..1]
	 */
	generate (time) {
		return Math.sin(Math.PI * 2 * time * 440 + Math.sin(Math.PI * 2 * time * 1) * 40 ) / 10;
		// return Math.random();
	}
}


Generator.prototype.blockSize = 512;
Generator.prototype.rate = 44100;


/** Audio-lab rendering settings */
Generator.prototype.numberOfOutputs = 1;
Generator.prototype.numberOfInputs = 0;

Generator.title = 'Generator';


export default Generator;