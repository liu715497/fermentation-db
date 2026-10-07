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


def test_openalex_enrich_with_mocked_api():
    """OpenAlex 批次查詢：以 DOI 對應被引用數、文章類型，再以 ISSN 取期刊指標。"""
    from pipeline import openalex

    class Resp:
        def __init__(self, data): self.data, self.status_code = data, 200
        def raise_for_status(self): pass
        def json(self): return self.data

    class Session:
        def __init__(self): self.calls = []
        def get(self, url, params, timeout):
            self.calls.append((url, params))
            if url.endswith("/works"):
                return Resp({"results": [{"doi": "https://doi.org/10.1/ABC", "cited_by_count": 12, "type": "article",
                                          "primary_location": {"source": {"issn_l": "1234-5678", "display_name": "J"}}}]})
            return Resp({"results": [{"issn_l": "1234-5678", "summary_stats": {"2yr_mean_citedness": 4.567}}]})

    arts = [{"pmcid": "PMC1", "doi": "10.1/abc"}, {"pmcid": "PMC2", "doi": None}]
    s = Session()
    assert openalex.enrich(arts, session=s) == 1
    assert arts[0]["cited_by_count"] == 12 and arts[0]["journal_2yr"] == 4.57 and arts[0]["work_type"] == "article"
    assert "cited_by_count" not in arts[1]                      # 沒有 DOI 的不查、不給 0
    assert s.calls[0][1]["filter"] == "doi:https://doi.org/10.1/abc"
