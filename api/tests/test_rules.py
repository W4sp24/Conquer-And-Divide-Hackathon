from app.pipeline.rules import parse_rules, pick_size

CODES = {"B1", "B3", "B7", "B12"}


def test_item_code():       assert parse_rules("mine B12", CODES, None)["item_code"] == "B12"
def test_code_spacing():    assert parse_rules("mine b 12 po", CODES, None)["item_code"] == "B12"
def test_code_dash():       assert parse_rules("pa-mine B-7", CODES, None)["item_code"] == "B7"
def test_bare_claim():      assert parse_rules("mine po", CODES, "B3")["item_code"] == "B3"
def test_lone_m():          assert parse_rules("m", CODES, "B1")["item_code"] == "B1"
def test_lone_m_no_cam():   assert parse_rules("m", CODES, None)["confidence"] < 0.75
def test_cancel():          assert parse_rules("cancel B12 po", CODES, None)["intent"] == "cancel"
def test_cancel_tagalog():  assert parse_rules("hindi na po B3", CODES, None)["intent"] == "cancel"
def test_chat_ignored():    assert parse_rules("hello ate ganda", CODES, "B1") is None
def test_question_ignored(): assert parse_rules("hm po B12?", CODES, "B1") is None
def test_description():     assert parse_rules("mine yung blue po", CODES, "B1")["confidence"] == 0.5
def test_unknown_code():    assert parse_rules("mine B99", CODES, None)["item_code"] is None
def test_waitlist():        assert parse_rules("backup B12", CODES, None)["intent"] == "waitlist"


def test_size_and_qty():
    r = parse_rules("mine B12 large 2pcs", CODES, None)
    assert (r["size"], r["qty"]) == ("L", 2)


def test_pick_size_numeric():
    assert pick_size("mine B2 30 po", ["28", "30", "32"]) == "30"


def test_pick_size_m_needs_hint():
    assert pick_size("mine B7", ["M", "L"]) is None
    assert pick_size("pa mine B7, M sana", ["M", "L"]) == "M"
    assert pick_size("mine B7 medium", ["M", "L"]) == "M"
