'use strict'
var P = require('partser')
var regex = P.regex
var string = P.string
var any = P.any
var seq = P.seq
var alt = P.alt
var eof = P.eof
var succeed = P.succeed
var fail = P.fail
var mark = P.lcMark
var times = P.times
var map = P.map
var desc = P.desc
var except = P.except
var replace = P.replace
var chain = P.chain

var anyNumberOf = function (p) {
  return times(p, 0, Infinity)
}
var between = function (p, before, after) {
  return map(seq(before, p, after), function (results) {
    return results[1]
  })
}
var secondOf = function (p1, p2) {
  return map(seq(p1, p2), function (x) { return x[1] })
}

var toStringNode = function (node) {
  return {
    type: 'string',
    content: node.value.join(''),
    location: {
      start: node.start,
      end: node.end
    }
  }
}

var toAtomNode = function (node) {
  var d = node.value

  return {
    type: 'atom',
    content: d.join ? d.join('') : d,
    location: {
      start: node.start,
      end: node.end
    }
  }
}

var toListNode = function (node) {
  return {
    type: 'list',
    content: node.value,
    location: {
      start: node.start,
      end: node.end
    }
  }
}

var construct = function () {
  var openParenChar = string('(')
  var closeParenChar = string(')')
  var commentChar = string(';')
  var escapeChar = string('\\')
  var stringDelimiterChar = string('"')
  var quoteChar = string("'")
  var quasiquoteChar = string('`')
  var unquoteChar = string(',')
  var unquoteSplicingModifierChar = string('@')
  var whitespaceChar = regex(/\s/)
  var whitespace = desc(times(whitespaceChar, 1, Infinity), 'whitespace')

  var endOfLineComment = desc(
      seq(
        commentChar,
        regex(/[^\n]*/),
        alt(string('\n'), eof)),
      'end-of-line comment')

  var optWhitespace = anyNumberOf(alt(endOfLineComment, whitespace))
  var lexeme = function (p) {
    return map(seq(p, optWhitespace), function (x) { return x[0] })
  }

  var singleCharEscape = map(
      seq(escapeChar, alt(
        string('b'),
        string('f'),
        string('n'),
        string('r'),
        string('t'),
        string('v'),
        string('0'),
        escapeChar)),
      function (chars) {
        var c = chars[1]
        switch (c) {
          case 'b': return '\b'
          case 'f': return '\f'
          case 'n': return '\n'
          case 'r': return '\r'
          case 't': return '\t'
          case 'v': return '\v'
          case '0': return '\0'
          default: return c
        }
      })

  var stringParser = (function () {
    var delimiter = stringDelimiterChar

    var escapedDelimiter = secondOf(escapeChar, delimiter)
    var escapedChar = alt(escapedDelimiter, singleCharEscape)

    var normalChar = except(any, alt(delimiter, escapeChar))

    var character = alt(normalChar, escapedChar)

    var content = desc(anyNumberOf(character), 'string content')

    var main = desc(
        lexeme(map(
            mark(
              between(
                content,
                desc(delimiter, 'string-opener'),
                desc(delimiter, 'string-terminator'))),
            toStringNode)),
        'string literal')

    main.delimiter = delimiter
    main.escapedDelimiter = escapedDelimiter
    main.escapedCharacter = escapedChar
    main.normalCharacter = normalChar
    main.anyCharacter = character
    main.content = content
    return main
  })()

  var atomParser = (function () {
    var needEscape = [
      commentChar,
      stringDelimiterChar,
      quoteChar,
      quasiquoteChar,
      unquoteChar,
      escapeChar,
      openParenChar,
      closeParenChar,
      whitespaceChar
    ]
    var charNeedingEscape = alt.apply(null, needEscape)
    var escapedChar = secondOf(escapeChar, charNeedingEscape)
    var normalChar = except(any, charNeedingEscape)

    var character = alt(escapedChar, normalChar)

    var main = desc(lexeme(map(
            mark(times(character, 1, Infinity)),
            toAtomNode)), 'atom')
    main.charNeedingEscape = charNeedingEscape
    main.escapedCharacter = escapedChar
    main.normalCharacter = normalChar
    main.anyCharacter = character
    return main
  })()

  var listOpener = desc(lexeme(openParenChar), 'opening paren')
  var listTerminator = desc(lexeme(closeParenChar), 'closing paren')

  var listParser = fail('implemented later')
  var quotedExpressionParser = fail('implemented later')
  var expression = alt(
    listParser,
    atomParser,
    stringParser,
    quotedExpressionParser)

  var listContent = desc(anyNumberOf(expression), 'list content')
  replace(listParser, map(
      mark(between(listContent, listOpener, listTerminator)),
      toListNode))

  quotedExpressionParser = (function () {
    var quote = map(
        mark(secondOf(quoteChar, succeed('quote'))),
        toAtomNode)
    var quasiquote = map(
        mark(secondOf(quasiquoteChar, succeed('quasiquote'))),
        toAtomNode)
    var unquote = map(
        mark(secondOf(unquoteChar, succeed('unquote'))),
        toAtomNode)
    var unquoteSplicing = map(
        mark(secondOf(
            seq(unquoteChar, unquoteSplicingModifierChar),
            succeed('unquote-splicing'))),
        toAtomNode)

    var anyQuote = alt(quote, quasiquote, unquoteSplicing, unquote)

    var main = desc(map(chain(

            lexeme(mark(anyQuote)),
            function (quoteResult) {
              return map(
                  mark(expression),
                  function (exprResult) {
                    var node = {
                      type: 'list',
                      value: [ quoteResult.value, exprResult.value ],
                      start: quoteResult.start,
                      end: exprResult.end
                    }
                    return node
                  })
            }), toListNode),
        'quoted expression')

    replace(quotedExpressionParser, main)

    main.quote = quote
    main.quasiquote = quasiquote
    main.unquote = unquote
    main.unquoteSplicing = unquoteSplicing
    main.anyQuote = anyQuote
    return main
  })()

  var shebangLine = desc(
      seq(regex(/^#![^\n]*/), alt(string('\n'), eof)),
      'shebang line')

  var main = map(
      seq(times(shebangLine, 0, 1), optWhitespace, anyNumberOf(expression)),
      function (x) { return x[2] })

  main.shebangLine = shebangLine
  main.expression = expression
  main.whitespace = whitespace
  main.comment = endOfLineComment
  main.escapeChar = escapeChar
  main.lexeme = lexeme

  endOfLineComment.openerChar = commentChar

  whitespace.character = whitespaceChar

  listParser.opener = openParenChar
  listParser.closer = closeParenChar
  listParser.content = listContent

  expression.atom = atomParser
  expression.list = listParser
  expression.string = stringParser
  expression.quotedExpression = quotedExpressionParser

  return main
} // end of constructor

module.exports = construct
