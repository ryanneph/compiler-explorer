// Copyright (c) 2022, Ryan Neph
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import path from 'path';

import _ from 'underscore';

import {BaseCompiler} from '../base-compiler';
import {logger} from '../logger';

// no enum in JS, so we do this instead...
const LINE_TYPE_NONE = -1;
const LINE_TYPE_EMPTY = 0;
const LINE_TYPE_LABEL = 1;
const LINE_TYPE_INST = 2;
const LINE_TYPE_TEXT = 3;
function getObjdumpLineType(line) {
    let line_type = LINE_TYPE_NONE;

    if (!line) line_type = LINE_TYPE_EMPTY;
    else if (line.endsWith(':')) line_type = LINE_TYPE_LABEL;
    else if (line.startsWith('  ')) line_type = LINE_TYPE_INST;
    else line_type = LINE_TYPE_TEXT;

    return line_type;
}

export class JaiCompiler extends BaseCompiler {
    static get key() {
        return 'jai';
    }

    constructor(info, env) {
        super(info, env);
        this.compiler.supportsIntel = true;
        this.compiler.supportsBinary = true;
        this.compiler.supportsExecute = false; // TODO: after providing custom outputPath to jai metaprogram
        this.compiler.supportsIrView = false;
        this.compiler.versionFlag = '-version';
    }

    async doCompilation(inputFilename, dirPath, key, options, filters, backendOptions, libraries, tools) {
        /* we wrap this to stash the inputFilename for use later. Without writing our own metaprogram,
         * jai defaults to producing an executable with the same path as the input file after the ".jai"
         * extension has been stripped. While having a simple metaprogram that allows setting the output
         * executable path would fit best into this architecture, for now, we just emit the outputFilename
         * based on the inputFilename. */
        this.inputFilename = inputFilename;

        /* force enable binary to use objdump for disassembly by default, otherwise the user must enable
         * the "Output -> Compile to binary" setting from the UI each time the page is visited. */
        filters.binary = true;

        return super.doCompilation(inputFilename, dirPath, key, options, filters, backendOptions, libraries, tools);
    }

    getOutputFilename(dirPath, outputFilebase, _key) {
        let outputFilename;
        if (!this.inputFilename) {
            outputFilename = path.join(dirPath, outputFilebase);
            logger.error(`Expected inputFilename to be stashed by now, but it is still undefined! This means we'll
almost certainly fail to generate a result. You could try again, or just complain to the dev and make them fix it...`);
            return path.join(dirPath, outputFilebase);
        }

        outputFilename = this.inputFilename.replace('.jai', '');
        logger.debug(`stashed inputFilename is '${this.inputFilename}', outputFilename is '${outputFilename}'`);
        return outputFilename;
    }

    prepareArguments(userOptions, filters, backendOptions, inputFilename, outputFilename, libraries) {
        /* base::doCompilation() calls this to pass user-specified args for us to insert into the
         * compiler args string. */
        // TODO: add support for linking with specified libraries.
        logger.debug(`User has specified compiler args: '${userOptions}'`);
        return [...userOptions].concat([inputFilename]);
    }

    postProcessObjdumpOutput(output) {
        /* manipulate the output of objdump before it is parsed into structured ASM for display.
         *
         * `objdump -l -d <exe-file>` produces a block for each function roughly matching the format:
         *
         * <full-path>:line_number
         *   0x******: op [bytes ..]      instruction    operands ...
         *   0x******: op [bytes ..]      instruction    operands ...
         *
         * <full-path>:line_number
         *   0x******: op [bytes ..]      instruction    operands ...
         *   0x******: op [bytes ..]      instruction    operands ...
         */

        /* only keep instructions that belong to the user's provided input by matching objdump
         * code locations with the inputFilename. All labels are retained for now to provide a
         * summary of the executable's contents without overwhelming the asm parser with several
         * thousand lines of linked instructions for even small program inputs. */
        let keep = [];
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let line_type = getObjdumpLineType(line);

            if (line_type === LINE_TYPE_EMPTY) {
                keep.push(line);
            } else if (line_type === LINE_TYPE_LABEL) {
                if (i >= lines.length - 1)
                    logger.error(`label on last line of objump is unexpected! The line is '${line}'`);

                keep.push(line);
            } /* line_type === LINE_TYPE_TEXT */
            // else if (line_type === LINE_TYPE_INST) {;}
            else {
                if (line.includes(this.inputFilename)) {
                    // advance to next label or text (code location), keeping all lines
                    keep.push(line);
                    i += 1;

                    while (i < lines.length - 1) {
                        const next_line = lines[i];
                        const next_type = getObjdumpLineType(next_line);
                        if (
                            next_type === LINE_TYPE_LABEL ||
                            (next_type === LINE_TYPE_TEXT && next_line !== this.inputFilename)
                        ) {
                            i -= 1;
                            break;
                        }

                        keep.push(lines[i]);
                        i += 1;
                    }
                }
            }
        }

        return keep.join('\n');
    }
}
