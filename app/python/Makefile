DIR_TOP=$(realpath ../..)/
include $(DIR_TOP)common.mak
TEST_CASES=server aoc faspex5 node shares node_v2
#  faspex
# shares_v2 cos cos_node_api cos_v2
# this folder
DIR_PY=$(CURDIR)/
# python execution environment folder
PYENV_DIR=$(DIR_PY).venv/
# python virtual environment activation script
PYENV_ACTIVATE=$(PYENV_DIR)bin/activate
# python source code folder
SRC=$(DIR_PY)src/
EXAMPLES=$(SRC)examples/
COMMON_SRC=$(SRC)utils/configuration.py $(SRC)utils/transfer_client.py $(SRC)utils/rest.py
# folder where generated grpc source code will be
PY_GRPC_GEN_DIR=$(PYENV_DIR)grpc_aspera/
# python grpc source code files, generated from proto file, also present in SDK
PY_GRPC_SDK_SRCS=transferd_pb2.py transferd_pb2_grpc.py
# location of pre-generated protobuf/grpc sources provided in SDK
PY_GRPC_SDK_DIR=$(SDK_DIR_EXAMPLES)python/
# comment out this line to use generated grpc source code from SDK
PY_GRPC_SDK_DIR=
# python grpc source code files used by sample code with full path
PY_FILES_GRPC = $(foreach item,$(PY_GRPC_SDK_SRCS),$(PY_GRPC_GEN_DIR)$(item))
all:: $(TEST_FLAGS)
# execute one sample
# 1. Ensure SDK is present
# 2. Create python virtual environment and Install required python packages
# 3. Generate or copy python grpc files
# 4. Ensure test file is present
# 5. Run the sample using the virtual environment
$(DIR_TESTED_FLAG)%: $(GBL_FILE_SAMPLE) $(FILES_RUNTIME) $(PYENV_ACTIVATE) $(PY_FILES_GRPC) $(COMMON_SRC) $(EXAMPLES)%.py
	@echo "== Test: $(notdir $@) ==========================="
	source $(PYENV_ACTIVATE) && \
		PYTHONPATH=$(PY_GRPC_GEN_DIR):$(SRC) \
		$(EXAMPLES)$(notdir $@).py $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
$(PYENV_ACTIVATE):
	python3 -m venv $(PYENV_DIR)
	source $(PYENV_ACTIVATE) && pip3 install -r $(SRC)requirements.txt
ifeq ($(PY_GRPC_SDK_DIR),)
# generate gRPC source code from proto file
# see https://grpc.io/docs/languages/python/quickstart/
$(PY_FILES_GRPC): $(SDK_FILE_PROTO) $(PYENV_ACTIVATE)
	@printf "\e[5mGenerating stub code from $(SDK_FILE_PROTO)\e[0m\n"
	mkdir -p $(PY_GRPC_GEN_DIR)
	source $(PYENV_ACTIVATE) && \
	  python -m grpc_tools.protoc \
	  --grpc_python_out=$(PY_GRPC_GEN_DIR) \
	  --python_out=$(PY_GRPC_GEN_DIR) \
	  --pyi_out=$(PY_GRPC_GEN_DIR) \
	  --proto_path=$(dir $(SDK_FILE_PROTO)) \
	  $(SDK_FILE_PROTO)
else
# copy grpc source code from SDK
$(PY_FILES_GRPC): $(FILES_RUNTIME)
	@printf "\e[5mCopying stub code from pre-compiled proto file in SDK\e[0m\n"
	mkdir -p $(PY_GRPC_GEN_DIR)
	cp $(foreach item,$(PY_GRPC_SDK_SRCS),$(PY_GRPC_SDK_DIR)$(item)) $(PY_GRPC_GEN_DIR)
endif
clean::
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
superclean:: clean
	rm -fr $(PYENV_DIR) $(PY_GRPC_GEN_DIR)
