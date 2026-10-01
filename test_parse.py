#!/usr/bin/env python3
"""
Tests for the CV-text contact recovery helpers (first_email / first_phone).
Offline — no token or network needed.

Run directly (python3 test_parse.py) or via smoke_test.sh.
"""

import unittest

import add_applicant as A


class FirstEmailTest(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(A.first_email('Email: jane@doe.com here'), 'jane@doe.com')

    def test_wrapped_tld_completes(self):
        # PDF split the TLD across a line break: "gmail.co\nm" -> "gmail.com".
        self.assertEqual(A.first_email('a@gmail.co\nm'), 'a@gmail.com')

    def test_trailing_word_not_swallowed(self):
        # A full word after the TLD on the next line must not be joined in.
        self.assertEqual(A.first_email('a@gmail.com\nPortfolio'), 'a@gmail.com')

    def test_genuine_co_tld_preserved(self):
        self.assertEqual(A.first_email('a@site.co and more'), 'a@site.co')

    def test_long_orphan_not_joined(self):
        # ">2 letter" continuation is a word, not a TLD tail.
        self.assertEqual(A.first_email('a@x.co\nmembers'), 'a@x.co')

    def test_none(self):
        self.assertIsNone(A.first_email('no address in here'))
        self.assertIsNone(A.first_email(''))
        self.assertIsNone(A.first_email(None))


class FirstPhoneTest(unittest.TestCase):
    def test_labelled_line_preferred(self):
        text = 'Skills\nMobile: 0779 4564 381\n2020 - 2022'
        self.assertEqual(A.first_phone(text), '0779 4564 381')

    def test_year_range_excluded(self):
        # "2024 - 2024" is 8 digits — below the 9-digit floor.
        self.assertIsNone(A.first_phone('Worked 2024 - 2024 at X'))

    def test_international(self):
        self.assertEqual(A.first_phone('Tel: +57 311 442 0266'), '+57 311 442 0266')

    def test_none(self):
        self.assertIsNone(A.first_phone(''))
        self.assertIsNone(A.first_phone(None))


class TgHandleTest(unittest.TestCase):
    def test_forms(self):
        for v in ('jane_doe_dev', '@jane_doe_dev', 'https://t.me/jane_doe_dev', 't.me/jane_doe_dev/'):
            self.assertEqual(A.tg_handle(v), 'jane_doe_dev')

    def test_invalid_is_refused_not_guessed(self):
        # "@jane doe_dev" (underscore lost in a PDF) must not become "jane".
        for v in ('@jane doe_dev', 'abc', '', None):
            self.assertIsNone(A.tg_handle(v))


if __name__ == '__main__':
    unittest.main()
