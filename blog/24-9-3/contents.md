# Writing a JSON Deserializer in Python

Recently, I've been following a tutorial on building an LLVM frontend for a toy programming language called Kaleidoscope - check it out [here](https://llvm.org/docs/tutorial/MyFirstLanguageFrontend/index.html).
At the time of writing this blog post (my first one!), I'm pretty much at the end of Part 2, and I've thus far implemented a lexer and parser which together produce an abstract syntax tree (AST).
With 8 parts left, I'm only just getting started - however, I decided to pause for a bit and try to apply what I've learned so far in a project, to test my newfound knowledge of lexical analysis and parsing.
Learning by tutorial is a great starting point for any skill, but to really understand how to apply that skill elsewhere, you have to... apply that skill elsewhere. Or, as TJ (Thomas Jefferson) once said:

<center><b>"What we learn to do, we learn by doing."</b></center>

So, I decided it would be a great idea to make my own JSON deserializer, which will lex and parse JSON into a Python dictionary.

## Exposition

[JSON](https://www.youtube.com/shorts/ybT58wVFy4Y), or JavaScript Object Notation, is a data format designed in 2001 for browser-server communication.
With a mere six data types and a straightforward hierarchical structure, it's a great starting point for practicing parsing.
And, with the ever growing popularity of frameworks like React and NoSQL databases like MongoDB, it's become an essential medium for data storage and transfer across the web.
Gone are the days of monolithic architectures serving HTML populated with data from a single SQL database, with some jQuery sprinkled in for interactivity.
Now, your React single page application (SPA) receives and deserializes JSON payloads from GraphQL queries to a dozen different microservices, which themselves receive, deserialize, and reserialize JSON from separate, sharded NoSQL databases storing binary JSON (BSON) in the cloud.
You gotta love the elegant simplicity of modern web dev!

When it's done, this deserializer should closely follow the behavior of the native Python implementation of a JSON deserializer - `json.load`.
It will take a file pointer to a .json file and produce a Python dictionary mapping keys to values.
Internally, it will be loading the file into memory line by line, lexing out tokens, and parsing these tokens in order to produce Python data types associated with each JSON data type:

| Python       | JSON     |
| ------------ | -------- |
| Dictionaries | Objects  |
| Lists        | Arrays   |
| Strings      | Strings  |
| Int/Floats   | Numbers  |
| Booleans     | Booleans |
| None         | null     |

Afterwards, I'll compare the performance to `json.load` to see how my implementation stacks up.
With a blazingly fast language like Python and tens of completed Leetcode problems under my belt, I'm sure to blow CPython's deserializer out of the water!

## The Lexer

Lexing tokens from a raw data source is the first step in deserializing JSON. The Lexer class will contain the data and methods used to iteratively fetch each token from the JSON file stream:

```python
class Lexer:

    def __init__(self, fs: io.TextIOBase) -> None:
        self.stream = fs
        self.line = self.stream.readline()
        self.lineNum = 1
        self.curr = ""
```

To avoid loading the whole file into memory, each line of the file will be read one at a time and stored in `self.line`.
After each new line is grabbed, `self.lineNum` will be updated for use by error reporting.
`self.curr` stores the current character, which each token lexing method will be responsible for updating after a new token is generated.

```python
 def nextChar(self) -> None:
    c = self.peek()
    if len(self.line) == 1:
        self.line = self.stream.readline()
        self.lineNum += 1
    elif c:
        self.line = self.line[1:]
    self.curr = c

def peek(self) -> str:
    if self.line:
        return self.line[0]
    return "EOF"
```

`nextChar()` grabs the next character in the line and consumes it, updating the line to the next one if necessary. `peek()` simply returns the next characer without consuming it. With this, we can [ define some tokens ](https://github.com/charliekim2/json-parser/blob/main/constants.py) and start lexing them.

```python
def lex_string(self) -> str:
    # parser knows token is string if it starts with "
    json_string = '"'

    self.nextChar()
    while self.curr and self.curr not in (JSON_QUOTE, "\n", "EOF"):
        json_string += self.curr
        self.nextChar()

    # EOF or line break before ending quote
    if self.curr != JSON_QUOTE:
        raise Exception(f"Expected end of string quote on line {self.lineNum}")

    return json_string
```

Since all tokens returned by the lexer are technically strings, a quote at the start specifies it is _actually_ a string.
It consumes the starting quote and then adds characters to the token string until it reaches the end quote.

```python
def lex_number(self) -> str:
    json_num = ""

    if self.curr not in JSON_NUMERIC:
        return json_num

    json_num += self.curr
    while self.peek() in JSON_NUMERIC:
        json_num += self.peek()
        self.nextChar()

    return json_num
```

Next is the number lexer, which notably lexes real numbers like -5e10, 0, and 44.5.
We simply add characters to the token string until one is no longer numeric.

```python
def lex_const(self) -> str:
    for const in JSON_CONST:
        if len(self.line) >= len(const) and self.line[: len(const)] == const:
            self.line = self.line[len(const) :]
            return const
    return ""
```

Finally, constants like NaN, Infinity, and True are lexed simply by checking if they exist at the beginning of the current line.
You may be thinking, "Wait a minute! NaN and +/- Infinity were left out of JSON spec, and for good reason!"
And you'd be right - except that [ Pythons JSON library ](https://docs.python.org/3/library/json.html) allows this:

> "If allow_nan is true (the default), then NaN, Infinity, and -Infinity will be encoded as such. This behavior is not JSON specification compliant, but is consistent with most JavaScript based encoders and decoders."

Clearly every language has a well defined and consistent implementation of these concepts, so I'm sure this extra feature will be appreciated by all.
With lexing constants done, the last things to do are lex structural tokens like brackets, braces, and commas. and put it all together.

```python
def getTok(self) -> str:

        while self.peek() in JSON_WHITESPACE:
            self.nextChar()

        json_const = self.lex_const()
        if json_const:
            return json_const

        self.nextChar()
        if self.curr in JSON_SYNTAX:
            return self.curr
        if self.curr == JSON_QUOTE:
            return self.lex_string()

        json_realnum = self.lex_number()
        if json_realnum:
            return json_realnum

        if self.curr == "EOF":
            return "EOF"

        raise Exception(f"Unexpected character: {self.curr} on line {self.lineNum}")
```

To get the next token in a JSON string, the lexer skips leading whitespace and then attempts to lex a token starting from the first character.
If it's unable to produce a token, the JSON is invalid so it raises an exception with the unexpected character and line it was on.

The completed lexer code can be found [here](https://github.com/charliekim2/json-parser/blob/main/lexing.py).

## The Parser

Onto the parser, which will use `getTok()` from a Lexer instance to construct a dictionary/list from (hopefully) valid JSON object.

```python
class Parser:
    def __init__(self, fs: io.TextIOBase) -> None:
        self.lexer: Lexer = Lexer(fs)
        self.currTok: str = ""

        self.next()
        if self.currTok != JSON_LEFTBRACE and self.currTok != JSON_LEFTBRACKET:
            raise Exception("Not a valid JSON object")

    def next(self) -> None:
        self.currTok = self.lexer.getTok()
```

Similarly to the lexer the parser keeps track of the current token. It checks if the first token is a left bracket or left brace to confirm the file is valid JSON. After writing a simple [cast function](https://github.com/charliekim2/json-parser/blob/main/parsing.py#L85) to cast token strings into Python data types, we can start parsing JSON structures.

```python
def parse(self):
    if self.currTok == "EOF":
        raise Exception("Nothing to parse")

    if self.currTok == JSON_LEFTBRACKET:
        return self.parse_list()
    if self.currTok == JSON_LEFTBRACE:
        return self.parse_object()
    return self.cast()
```

Notably, `parse_list()` and `parse_object()` will be calling `parse()` recursively to produce list elements and key value pairs.
The hierarchical structure of JSON means tokens are lexed in the order a DFS algorithm would visit nodes in the JSON "tree" - so using recursion and letting the call stack do a lot of the heavy lifting for us just makes sense.

```python
def parse_list(self) -> List[object]:
    arr = []

    # Consume left bracket
    self.next()
    while self.currTok != JSON_RIGHTBRACKET:
        parsedTok = self.parse()
        arr.append(parsedTok)

        if self.currTok == JSON_COMMA:
            # Consume comma and proceed to next list item
            self.next()
        elif self.currTok != JSON_RIGHTBRACKET:
            raise Exception(
                f"Expected end of array ] or comma at line {self.lexer.lineNum}"
            )

    # Consume right bracket
    self.next()
    return arr
```

To parse an array, we consume the left bracket of the array and start parsing and adding items to the list. Once an item is added, a comma must follow, or the array is not valid JSON. If there isn't a comma, it must be the end of the array, which means the token must be a right bracket.

```python
def parse_object(self) -> Dict:
    obj = {}

    # Consume left brace
    self.next()
    while self.currTok != JSON_RIGHTBRACE:
        parsedKey = self.parse()

        # JSON keys must be strings
        if type(parsedKey) != str:
            raise Exception(
                f"Invalid key of type {type(parsedKey)} on line {self.lexer.lineNum}"
            )
        if parsedKey in obj:
            raise Exception(
                f"Duplicate field {parsedKey} found on line {self.lexer.lineNum}"
            )
        if self.currTok != JSON_COLON:
            raise Exception(
                f"Expected colon after key {parsedKey} on line {self.lexer.lineNum}"
            )

        # Consume colon and get value
        self.next()
        parsedVal = self.parse()
        obj[parsedKey] = parsedVal

        if self.currTok == JSON_COMMA:
            # Consume comma and proceed to next kvp
            self.next()
        elif self.currTok != JSON_RIGHTBRACE:
            raise Exception(
                f"Expected end of object or comma at line {self.lexer.lineNum}"
            )

    # Consume right brace
    self.next()
    return obj
```

Parsing an object into a dictionary is similar to arrays, where we consume the left brace and then parse and add key value pairs to the dict, checking for 3 things:

- keys are strings
- each key is followed by a colon
- each pair is followed by a comma or right brace

Duplicate keys are for some reason considered syntactically valid JSON - an impossibility for hashmaps like the dictionaries we are creating here.
We'll instead raise an exception when this occurs. While I may have been tongue-in-cheek in breaking the spec before, I do really think this change is for the better.

The completed parser code can be found [here](https://github.com/charliekim2/json-parser/blob/main/parsing.py).

## Comparing to `json.load`

With the parser done, the time has now come to write a simple wrapper to more closely imitate Pythons `json.load` function.

```python
def load(fs: io.TextIOBase):
    p = Parser(fs)

    return p.parse()
```

Then, we can write a quick profiling test to finally show how our blazingly fast deserializer wipes the floor with the native one.
Thanks to Microsoft for providing some [ dummy JSON data ](https://microsoftedge.github.io/Demos/json-dummy-data/).

```python
def profile_parsers(filename):
    num_iterations = 10
    myparser_total = 0
    jsonload_total = 0

    for _ in range(num_iterations):
        with open(filename, "r") as f:
            start = process_time()
            myjson.load(f)
            end = process_time()

            myparser_total += end - start

        with open(filename, "r") as f:
            start = process_time()
            json.load(f)
            end = process_time()

            jsonload_total += end - start

    print(
        f"MY PARSER: Average time to process {filename}: {round( myparser_total / num_iterations, 4 )} seconds"
    )
    print(
        f"JSON.LOAD: Average time to process {filename}: {round( jsonload_total / num_iterations, 4 )} seconds"
    )
```

Because both functions use IO reading methods `read` and `readline`, the file pointer gets moved to the end of the file by the end of parsing, so it's important to close and reopen the file every time `load` is called.

Let's see the results:

```
MY PARSER: Average time to process ./sample/64KB.json: 0.0152 seconds
JSON.LOAD: Average time to process ./sample/64KB.json: 0.0002 seconds

MY PARSER: Average time to process ./sample/5MB.json: 1.2007 seconds
JSON.LOAD: Average time to process ./sample/5MB.json: 0.0193 seconds
```

Well that's not good...

However, there's a catch. If we take a look a the [ CPython source code ](https://github.com/python/cpython/tree/main) for `json.load`, there is a glaring issue:

```python
"""JSON token scanner
"""
import re
try:
    from _json import make_scanner as c_make_scanner

...


"""Implementation of JSONDecoder
"""
import re

from json import scanner
try:
    from _json import scanstring as c_scanstring
```

As we can see, it imports an implementation written in C to scan the file and fetch tokens.
Clearly this is cheating! If Python is blazingly fast, then C is _super duper_ blazingly fast.
In order to make this an even fight, we should remove the C code imports and rebuild Python from source so it has to use the Python scanners `py_make_scanner` and `py_scanstring`.
Using the new Python executable we can rerun the tests to see how the deserializers really fare against each other.

```
MY PARSER: Average time to process ./sample/64KB.json: 0.0189 seconds
JSON.LOAD: Average time to process ./sample/64KB.json: 0.0023 seconds

MY PARSER: Average time to process ./sample/5MB.json: 1.4151 seconds
JSON.LOAD: Average time to process ./sample/5MB.json: 0.1824 seconds
```

Ok, still not great. Despite a 10x slowdown, the json library is still 5-10x faster than our code (and for some reason, the edited source code consistently ran a bit slower in general. This may be because manually building it produced a less optimized binary than the one you can get prebuilt online, but I'm not sure).
I would call this a sound defeat at the hands of the native json library, so let's take a look at how it runs so fast.

```python
def _scan_once(string, idx):
    try:
        nextchar = string[idx]
    except IndexError:
        raise StopIteration(idx) from None

    if nextchar == '"':
        return parse_string(string, idx + 1, strict)
    elif nextchar == '{':
        return parse_object((string, idx + 1), strict,
            _scan_once, object_hook, object_pairs_hook, memo)
    elif nextchar == '[':
        return parse_array((string, idx + 1), _scan_once)
    ...
```

First of all, rather than lexing tokens and parsing them in separate tasks, `json.load` does both at the same time.
That already gets rid of most of the conditional control flow, and assuming a typical JSON object consisting of strings and brackets/braces, the if/else chain should return fairly early most of the time.

You may have noticed and winced at all the string slicing we did, which ran on every string parse and `getChar()` call, and is worst-case O(n) time.
For very long strings this is especially bad, as that means equally long slicing time.
`json.load` instead uses the index `idx` to traverse the JSON string and avoid copying or modifying the string.

Add those things to the fact that it reads the whole file into memory rather than one line at a time, avoiding the overhead of reading disk - and it becomes clear why `json.load` is so much faster, even without some C code helping out.

As an aside, loading entire files into memory is a great plan until the files become too big to fit.
And while `readline()` does prevent this issue for nice, human readable JSON with lots of line breaks, it also runs into problems when you try to lex a minified file with all the whitespace removed.
The best solution would be to use `load(int)` to fetch fixed-size chunks from the file.

## Conclusion

Obviously, the point of this was not to get destroyed by the existing JSON deserializer in Python.

While it was fun comparing the performance of the two deserializers, this was moreso an exercise and review of lexing and parsing concepts.
Nonetheless, it was informative seeing how the Python json library works under the hood - there are many situations where it makes sense to combine the lexing and parsing steps in order to save time, so I'll definitely have to think of that next time.

Special thanks to [Phil Eaton](https://eatonphil.com/) for writing this cool [article](https://notes.eatonphil.com/writing-a-simple-json-parser.html) which gave me this idea and provided a great starting point.

Hope you enjoyed!
