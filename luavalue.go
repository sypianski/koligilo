package main

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Literały Lua po stronie serwera — lustro Sync.serialize / Sync.deserialize
// z pluginu (ten sam deterministyczny format). Potrzebne panelowi, który sam
// zapisuje konta (kosync, Wallabag, Dropbox…) jako wspólne wartości.
//
// Mapowanie typów: string, bool, float64 (liczby), map[string]any (tabela
// z kluczami-napisami), []any (lista 1..n). Tabele mieszane nie są potrzebne
// do kont, więc decodeLua je odrzuca. Pusta tabela {} dekoduje się jako
// map[string]any{} — asList traktuje ją jak pustą listę.

func encodeLua(v any) (string, error) {
	var b strings.Builder
	if err := encLua(&b, v, 0); err != nil {
		return "", err
	}
	return b.String(), nil
}

func encLua(b *strings.Builder, v any, depth int) error {
	if depth > 32 {
		return errors.New("za głęboko zagnieżdżone")
	}
	switch x := v.(type) {
	case string:
		b.WriteString(quoteLua(x))
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case int:
		b.WriteString(strconv.Itoa(x))
	case float64:
		s, err := numLua(x)
		if err != nil {
			return err
		}
		b.WriteString(s)
	case []any:
		b.WriteByte('{')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			fmt.Fprintf(b, "[%d]=", i+1)
			if err := encLua(b, e, depth+1); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys) // jak table.sort w Lua: porządek bajtowy
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString("[" + quoteLua(k) + "]=")
			if err := encLua(b, x[k], depth+1); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return fmt.Errorf("typ %T", v)
	}
	return nil
}

func quoteLua(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			b.WriteString(`\"`)
		case c == '\\':
			b.WriteString(`\\`)
		case c == '\n':
			b.WriteString(`\n`)
		case c == '\r':
			b.WriteString(`\r`)
		case c == '\t':
			b.WriteString(`\t`)
		case c < 32 || c == 127:
			fmt.Fprintf(&b, `\%03d`, c)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func numLua(n float64) (string, error) {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return "", errors.New("liczba nieskończona/NaN")
	}
	if n == math.Floor(n) && math.Abs(n) < 1<<53 {
		return strconv.FormatInt(int64(n), 10), nil
	}
	return fmt.Sprintf("%.17g", n), nil
}

// decodeLua czyta DOKŁADNIE format encodeLua / Sync.serialize.
func decodeLua(s string) (v any, err error) {
	p := &luaParser{s: s}
	defer func() {
		if r := recover(); r != nil {
			v, err = nil, fmt.Errorf("%v", r)
		}
	}()
	v = p.value(0)
	p.ws()
	if p.pos < len(p.s) {
		panic(fmt.Sprintf("śmieci po wartości na %d", p.pos+1))
	}
	return v, nil
}

type luaParser struct {
	s   string
	pos int
}

func (p *luaParser) ws() {
	for p.pos < len(p.s) && strings.IndexByte(" \t\r\n", p.s[p.pos]) >= 0 {
		p.pos++
	}
}

func (p *luaParser) str() string {
	p.pos++ // "
	var b strings.Builder
	for {
		if p.pos >= len(p.s) {
			panic("niedomknięty napis")
		}
		c := p.s[p.pos]
		switch c {
		case '"':
			p.pos++
			return b.String()
		case '\\':
			if p.pos+1 >= len(p.s) {
				panic("niedomknięty napis")
			}
			e := p.s[p.pos+1]
			switch {
			case e == 'n':
				b.WriteByte('\n')
				p.pos += 2
			case e == 'r':
				b.WriteByte('\r')
				p.pos += 2
			case e == 't':
				b.WriteByte('\t')
				p.pos += 2
			case e == '"' || e == '\\':
				b.WriteByte(e)
				p.pos += 2
			case e >= '0' && e <= '9':
				j := p.pos + 1
				for j < len(p.s) && j < p.pos+4 && p.s[j] >= '0' && p.s[j] <= '9' {
					j++
				}
				n, _ := strconv.Atoi(p.s[p.pos+1 : j])
				if n > 255 {
					panic("zły kod znaku")
				}
				b.WriteByte(byte(n))
				p.pos = j
			default:
				panic("nieznana sekwencja \\" + string(e))
			}
		default:
			b.WriteByte(c)
			p.pos++
		}
	}
}

func (p *luaParser) value(depth int) any {
	if depth > 32 {
		panic("za głęboko")
	}
	p.ws()
	if p.pos >= len(p.s) {
		panic("brak wartości")
	}
	switch c := p.s[p.pos]; {
	case c == '"':
		return p.str()
	case c == '{':
		return p.table(depth)
	case strings.HasPrefix(p.s[p.pos:], "true"):
		p.pos += 4
		return true
	case strings.HasPrefix(p.s[p.pos:], "false"):
		p.pos += 5
		return false
	default:
		j := p.pos
		for j < len(p.s) && strings.IndexByte("-+.0123456789eE", p.s[j]) >= 0 {
			j++
		}
		n, err := strconv.ParseFloat(p.s[p.pos:j], 64)
		if err != nil || j == p.pos {
			panic(fmt.Sprintf("nieoczekiwany znak na %d", p.pos+1))
		}
		p.pos = j
		return n
	}
}

func (p *luaParser) table(depth int) any {
	p.pos++ // {
	strs := map[string]any{}
	nums := map[int]any{}
	for {
		p.ws()
		if p.pos < len(p.s) && p.s[p.pos] == '}' {
			p.pos++
			break
		}
		if p.pos >= len(p.s) || p.s[p.pos] != '[' {
			panic(fmt.Sprintf("oczekiwano [ na %d", p.pos+1))
		}
		p.pos++
		k := p.value(depth + 1)
		p.ws()
		if !strings.HasPrefix(p.s[p.pos:], "]=") {
			panic(fmt.Sprintf("oczekiwano ]= na %d", p.pos+1))
		}
		p.pos += 2
		v := p.value(depth + 1)
		switch kk := k.(type) {
		case string:
			strs[kk] = v
		case float64:
			if kk != math.Floor(kk) || kk < 1 {
				panic("klucz liczbowy spoza listy")
			}
			nums[int(kk)] = v
		default:
			panic("zły klucz")
		}
		p.ws()
		if p.pos < len(p.s) && p.s[p.pos] == ',' {
			p.pos++
			continue
		}
		if p.pos < len(p.s) && p.s[p.pos] == '}' {
			p.pos++
			break
		}
		panic(fmt.Sprintf("oczekiwano , lub } na %d", p.pos+1))
	}
	if len(nums) == 0 {
		return strs
	}
	if len(strs) > 0 {
		panic("tabela mieszana (lista i klucze)")
	}
	list := make([]any, len(nums))
	for i := 1; i <= len(nums); i++ {
		v, ok := nums[i]
		if !ok {
			panic("lista z dziurami")
		}
		list[i-1] = v
	}
	return list
}

// asList: lista z literału (pusta tabela {} też jest pustą listą).
func asList(v any) ([]any, bool) {
	switch x := v.(type) {
	case []any:
		return x, true
	case map[string]any:
		return []any{}, len(x) == 0
	}
	return nil, false
}
