"""書目解析與全文段落篩選（離線測試，不連 NCBI）。"""

from pipeline.ncbi import bioc_to_text, license_label, parse_jats_metadata

JATS = b"""<?xml version="1.0"?>
<pmc-articleset><article xmlns:xlink="http://www.w3.org/1999/xlink">
<front><journal-meta><journal-title-group><journal-title>Nutrients</journal-title></journal-title-group></journal-meta>
<article-meta>
<article-id pub-id-type="pmcid">PMC1234567</article-id><article-id pub-id-type="pmid">111</article-id>
<title-group><article-title>Fermented <italic>soy</italic> milk and glucose</article-title></title-group>
<contrib-group><contrib contrib-type="author"><name><surname>Chen</surname></name></contrib></contrib-group>
<pub-date><year>2024</year></pub-date>
<permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/></permissions>
</article-meta></front></article></pmc-articleset>"""


def test_parse_jats():
    row = parse_jats_metadata(JATS)[0]
    assert row["pmcid"] == "PMC1234567" and row["year"] == 2024 and row["license"] == "CC BY"
    assert row["title"] == "Fermented soy milk and glucose" and row["first_author"] == "Chen"


def test_license_labels():
    assert license_label("http://creativecommons.org/licenses/by-nc/4.0/") == "CC BY-NC"
    assert license_label("https://creativecommons.org/publicdomain/zero/1.0/") == "CC0"
    assert license_label("https://example.com/terms") == "unknown"


def test_bioc_keeps_only_core_sections():
    doc = {"documents": [{"passages": [
        {"infons": {"section_type": "TITLE"}, "text": "T"},
        {"infons": {"section_type": "REF"}, "text": "should drop"},
        {"infons": {"section_type": "RESULTS"}, "text": "R"}]}]}
    assert bioc_to_text(doc) == "[TITLE] T\n[RESULTS] R"
