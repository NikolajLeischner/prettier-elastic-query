let _ = require('underscore');
let pp = require('prettier-printer');
let prism = require('prismjs');
let queryGrammar = require('./grammar');


// import css for webpack to include
/* eslint-disable-next-line no-unused-vars */
let prismTheme = require('prismjs/themes/prism.css');


let syntaxActionsMap = {
    'nonemptyListOf': flattenNonemptyListOf,
    'spaced': flattenSpaced,
    'parented': flattenParented,
    'boolOperator': flattenBoolOperator,
    'longNegation': flattenLongNegation,
    'simpleNegation': flattenSimpleNegation,
    'simpleMust': flattenSimpleMust,
    'detachedCond': flattenDetachedCondition,
    'fieldCond': flattenFieldCondition,
    'orSpace': flattenOrSpace,
    'rangeCond': flattenRangeCondition,
    'simpleRangeCond': flattenSimpleRangeCondition,
    'regexCond': flattenRegexCondition,
    '_terminal': terminalAction,
};


function terminalAction() {
    return this.primitiveValue;
}


function flattenNonemptyListOf(first, separators, rest) {
    let topNodes = [first].concat([separators, rest]);
    let childrenWithOffsets = [];
    topNodes.map(function(node) {
        _.map(node.children, function (child, idx) {
            childrenWithOffsets.push({
                'offset': node._node.childOffsets[idx],
                'child': child,
            });
        });
    });
    let sortedChildren = _.sortBy(childrenWithOffsets, 'offset');
    return sortedChildren.map(function(wrap) {
        return wrap.child.flatten();
    });
}


function flattenSpaced(_, innerNode, __) {
    return innerNode.flatten();
}


function flattenOrSpace(children) {
    return {
        'type': 'boolOperator',
        'value': 'IMP-OR',
    };
}


function flattenParented(_, __, innerNode, ___, ____) {
    return {
        'type': 'parented',
        'value': innerNode.flatten(),
    };
}


function flattenBoolOperator(children) {
    let operator = children._node.primitiveValue;
    return {
        'type': 'boolOperator',
        'value': operator,
    };
}


function flattenFieldCondition(nameNode, _, valueNode) {
    return {
        'type': 'fieldCondition',
        'name': nameNode.sourceString,
        'value': valueNode.flatten(),
    };
}


function flattenRangeCondition(bracketOpen, __, fromValue, ___, toValue, ____, bracketClose) {
    return {
        'type': 'rangeCondition',
        'from': fromValue.sourceString,
        'from-bracket': bracketOpen.sourceString,
        'to-bracket': bracketClose.sourceString,
        'to': toValue.sourceString,
    };
}


function flattenSimpleRangeCondition(operand, value) {
    return {
        'type': 'simpleRangeCondition',
        'operand': operand.sourceString,
        'value': value.flatten(),
    };
}


function flattenRegexCondition(_, expression, __) {
    return {
        'type': 'regexCondition',
        'expression': expression.sourceString,
    };
}


function flattenLongNegation(negation, spaces, condition) {
    return {
        'type': 'marking',
        'op': 'NOT',
        'value': condition.flatten(),
    };
}


function flattenSimpleNegation(_, condition) {
    return {
        'type': 'marking',
        'op': '-',
        'value': condition.flatten(),
    };
}


function flattenSimpleMust(_, condition) {
    return {
        'type': 'marking',
        'op': '+',
        'value': condition.flatten(),
    };
}


function flattenDetachedCondition(children) {
    return this.sourceString;
}


function formatFlatTree(tree, maxWidth, style) {
    style = style || 'lisp';

    let formattersMap = {
        'parented': formatParented,
        'boolOperator': formatBoolOperator,
        'fieldCondition': formatFieldCondition,
        'marking': formatMarking,
        'rangeCondition': formatRangeCondition,
        'simpleRangeCondition': formatSimpleRangeCondition,
        'regexCondition': formatRegexCondition,
    };

    return pp.render(maxWidth, pp.group(formatNodeRecursively(tree)));

    function wrap(result) {
        switch (style) {
        case 'lisp':
            // lisp-style align from '('
            return pp.group(pp.hang(1, result));
        case 'simple':
            // simple 2 space indent alignment
            return pp.group(pp.nest(2, result));
        default:
            throw new Error('Unknown formatting style \'' + style + '\'');
        }
    }

    function formatParented(node) {
        let children = _.filter(formatNodeRecursively(node['value']), null);
        return wrap(pp.enclose(
            pp.parens,
            pp.enclose([pp.softBreak, pp.softBreak], children)));
    }

    function formatBoolOperator(node) {
        if (node['value'] == 'IMP-OR') {
            // implicit OR operator
            return null;
        } else {
            // FIXME: in rare cases this lineBreak adds up to softLine in list
            // merge and produces empty lines in the output
            return pp.prepend(pp.lineBreak, node['value']);
        }
    }

    function formatFieldCondition(node) {
        let result = formatNodeRecursively(node['value']);
        return [node['name'], ':', result];
    }


    function formatRegexCondition(node) {
        return pp.enclose(['/', '/'], node['expression']);
    }

    function formatMarking(node) {
        if (node['op'] == 'NOT') {
            return wrap(
                pp.intersperse(pp.softLine, [node['op'], formatNodeRecursively(node['value'])]));
        } else {
            // simple marking with "-" or "+" does not require a space
            return wrap([node['op'], formatNodeRecursively(node['value'])]);
        }
    }

    function formatRangeCondition(node) {
        return wrap([
            node['from-bracket'],
            pp.intersperse(pp.softLine, [node['from'], 'TO', node['to']]),
            node['to-bracket'],
        ]);
    }

    function formatSimpleRangeCondition(node) {
        let value = formatNodeRecursively(node['value']);
        return [node['operand'], value];
    }

    function formatNodeRecursively(node) {
        switch (typeof node) {
        case 'string':
            return node;
        case 'object':
            if (node instanceof Array) {
                let children = _.filter(node.map(formatNodeRecursively), null);
                return pp.intersperse(pp.softLine, children);
            } else {
                let formatter = formattersMap[node['type']];
                if (formatter) {
                    return formatter(node);
                }
                return '<NO FORMATER DEFINED FOR \'' + node['type'] + '\'>';
            }
        default:
            throw new Error('Unknown object type \'' + (typeof node) + '\'');
        }
    }
}


function parseQuery(query) {
    let match = queryGrammar.match(query);
    if (match.failed()) {
        let error = new Error('Can not parse query');
        error.message = match.message;
        error.shortMessage = match.shortMessage;
        error.rightmostFailurePosition = match.getRightmostFailurePosition();
        error.expectedText = match.getExpectedText();
        error.match = match;
        // TODO: format and highlight partial match if possible
        throw error;
    }
    let semantics = queryGrammar.createSemantics().addOperation('flatten', syntaxActionsMap);
    let tree = semantics(match);
    let flatTree = tree.flatten();
    return flatTree;
}


function formatQuery(query, maxWidth, style) {
    let flatTree = parseQuery(query);
    return formatFlatTree(flatTree, maxWidth, style);
}


prism.languages.esquery = {
    'string': {
        pattern: /(^|[^@\\])("|')(?:\\[\s\S]|(?!\2)[^\\])*\2/,
        greedy: true,
        lookbehind: true,
    },
    'variable': /@[\w.$]+|@(["'`])(?:\\[\s\S]|(?!\1)[^\\])+\1/,
    'boolean': /\b(?:true|false|null)\b/i,
    'number': /\b0x[\da-f]+\b|\b\d+\.?\d*|\B\.\d+\b/i,
    'operator': /[-+\/=%^~]|&&?|\|\|?|!=?|<(?:=>?|<|>)?|>[>=]?|\b(?:AND|OR|TO|NOT|_exists_)\b/i,
    'punctuation': /[;[\]{}()`,.]/,
};


function extendHighlighter(options) {
    let keywords = options['keywords'] || [];
    if (keywords) {
        let keywordsExpr = '\\b(?:' + keywords.join('|') + ')\\b';
        prism.languages.esquery['keyword'] = new RegExp(keywordsExpr, 'i');
    }
}


function highlightQuery(query) {
    return prism.highlight(query, prism.languages.esquery, 'esquery');
}


function prettify(query, maxWidth, style) {
    maxWidth = maxWidth || 100;
    let formatted = formatQuery(query, maxWidth, style);
    let highlighted = highlightQuery(formatted);
    return highlighted;
}


function formatErrorMessage(error, cssClass) {
    let styling = (
        cssClass ? ('class="' + cssClass + '"') : 'style="color:red"');
    return '<p ' + styling + '>' + error.shortMessage + '</p>';
}


function prettifyElement(elementId, showErrors, maxWidth, errorCss) {
    let element = document.getElementById(elementId);
    let query = element.innerText.trim();
    let result;
    try {
        result = prettify(query, maxWidth);
    } catch (error) {
        if (showErrors) {
            element.innerHTML = (
                markErrorInQuery(query, error, errorCss)
                + formatErrorMessage(error, errorCss));
            return element;
        }
        return false;
    }
    element.innerHTML = result;
    return element;
}


function markErrorInQuery(query, error, cssClass) {
    let index = error.rightmostFailurePosition;
    let part1 = query.slice(0, index);
    let part2 = query.slice(index + 1);
    let styling;
    if (cssClass) {
        styling = 'class="' + cssClass + '"';
    } else {
        styling = (
            'style="text-decoration-color: red;-webkit-text-decoration-color: red;color: red;"');
    }
    return part1 + '<u ' + styling + '>' + query[index] + '</u>' + part2;
}


let PrettierEs = {
    prettify: prettify,
    prettifyElement: prettifyElement,
    format: formatQuery,
    highlight: highlightQuery,
    parse: parseQuery,
    extendHighlighter: extendHighlighter,
    markErrorInQuery: markErrorInQuery,
    prism: prism,
    grammar: queryGrammar,
};


module.exports = PrettierEs;


if (typeof window !== 'undefined') {
    window.PrettierEs = PrettierEs;
}
