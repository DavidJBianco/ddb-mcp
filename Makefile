.DEFAULT_GOAL := help

IMAGE ?= mysterium:local
TEST_IMAGE ?= mysterium:test
BUILD_DOCKER_IMAGE ?= 1
DOCKER_TEST_SCRIPT ?= test:docker:run
BIN_DIR ?= bin
AUTH_HELPER := $(BIN_DIR)/mysterium-auth
AUTH_HELPER_ABS := $(abspath $(AUTH_HELPER))
DEPS_STAMP := node_modules/.package-lock.json
override PACKAGE_VERSION := $(shell node -p "require('./package.json').version")
RELEASE_DIR ?= release
RELEASE_IMAGE ?=
AUTH_LDFLAGS = -s -w -X main.version=$(PACKAGE_VERSION) -X main.defaultImage=$(IMAGE)

.PHONY: help deps build build-server image helper sync-auth-version check-auth-version release-catalog check audit test test-offline test-helper test-docker test-all live-test-host live-test login run

help:
	@printf '%s\n' \
		'make deps         Install the locked Node dependencies when needed' \
		'make build        Build dist, the Docker image, and the auth helper' \
		'make image        Build the Docker image ($(IMAGE))' \
		'make helper       Build $(AUTH_HELPER) for the current host' \
		'make release-catalog  Generate a catalog pinned to RELEASE_IMAGE' \
		'make check        Run lint and type checks' \
		'make test         Run lint, type checks, offline tests, and Go tests' \
		'make test-docker  Build and exercise the production container' \
		'make test-all     Run the normal and Docker test suites' \
		'make live-test    Run the opt-in, read-only Docker live suite' \
		'make live-test-host  Run the opt-in host live suite' \
		'make audit        Audit production npm dependencies' \
		'make login        Build local artifacts and start browser login' \
		'make run          Run the local image over stdio' \
		'' \
		'Overrides: IMAGE=<tag> TEST_IMAGE=<tag> BIN_DIR=<directory>'

deps: $(DEPS_STAMP)

$(DEPS_STAMP): package.json package-lock.json
	npm ci

build: build-server image helper

build-server: deps
	npm run build

image:
	docker build --tag "$(IMAGE)" .

helper: sync-auth-version
	node -e "require('node:fs').mkdirSync(process.argv[1], { recursive: true })" "$(BIN_DIR)"
	go -C cmd/mysterium-auth build -trimpath -ldflags "$(AUTH_LDFLAGS)" -o "$(AUTH_HELPER_ABS)" .

sync-auth-version:
	node scripts/sync-auth-version.mjs

check-auth-version:
	node scripts/sync-auth-version.mjs --check

release-catalog:
	test -n "$(RELEASE_IMAGE)"
	mkdir -p "$(RELEASE_DIR)"
	sed 's|^image: .*|image: $(RELEASE_IMAGE)|' mysterium.yaml > "$(RELEASE_DIR)/mysterium.yaml"
	grep -Fqx 'name: mysterium' "$(RELEASE_DIR)/mysterium.yaml"
	grep -Fqx 'image: $(RELEASE_IMAGE)' "$(RELEASE_DIR)/mysterium.yaml"

check: deps
	npm run lint
	npm run typecheck

audit: deps
	npm audit --audit-level=high --omit=dev

test: check test-helper test-offline

test-offline: deps
	npm test

test-helper: check-auth-version
	go -C cmd/mysterium-auth test ./...
	go -C cmd/mysterium-auth vet ./...

test-docker: deps
ifeq ($(BUILD_DOCKER_IMAGE),1)
	docker build --tag "$(TEST_IMAGE)" .
endif
	MYSTERIUM_TEST_IMAGE="$(TEST_IMAGE)" npm run "$(DOCKER_TEST_SCRIPT)"

test-all: test test-docker

live-test-host: deps
	npm run test:live

live-test: deps
	npm run test:live:docker

login: image helper
	"./$(AUTH_HELPER)" login --image "$(IMAGE)"

run: image
	docker run --rm --interactive --volume mysterium-session:/home/mcp/.config/mysterium:ro "$(IMAGE)"
