DIR_TOP=$(CURDIR)/../
TEST_CASES=aoc cos cos_node_api faspex faspex5 node shares server
# cos_v2 node_v2 shares_v2
include $(DIR_TOP)common.mak
DIR_PYENV=$(CURDIR)/.venv/
SRC=./src/
PYTHON_SRC_GEN=$(DIR_PYENV)/grpc_aspera/
export PYTHON_SRC_GEN
all:: $(TEST_FLAGS)
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	source $(DIR_PYENV)bin/activate && $(SRC)$(notdir $@).py $(SAMPLE_FILE)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
# initialize python environment
$(ENV_IS_SETUP): $(SDK_FILES)
	python3 -m venv $(DIR_PYENV)
	source $(DIR_PYENV)bin/activate && pip3 install -r $(SRC)requirements.txt
	mkdir -p $(PYTHON_SRC_GEN)
	source $(DIR_PYENV)bin/activate && python -m grpc_tools.protoc \
	  --python_out=$(PYTHON_SRC_GEN) \
	  --pyi_out=$(PYTHON_SRC_GEN) \
	  --grpc_python_out=$(PYTHON_SRC_GEN) \
	  --proto_path=$(dir $(PROTO_FILE)) \
	  $(PROTO_FILE)
	@touch $@
clean::
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
superclean:: clean
	rm -fr $(DIR_PYENV) $(PYTHON_SRC_GEN)
