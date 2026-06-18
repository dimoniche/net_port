cmake_minimum_required(VERSION 3.10)
project(module_net_port_server C)

set(CMAKE_C_STANDARD 11)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

set(VERSION_MAJOR 0)
set(VERSION_MINOR 0)
set(VERSION_PATCH 4)
set(BUILD_REVISION 0)
set(SOFT_VERSION ${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH})
set(MODULE_NAME module_net_port_server)

include(generate_product_version)
generate_product_version(
        VersionFilesOutputVariable
        NAME ${MODULE_NAME}
        VERSION_MAJOR ${VERSION_MAJOR}
        VERSION_MINOR ${VERSION_MINOR}
        VERSION_PATCH ${VERSION_PATCH}
        VERSION_REVISION ${BUILD_REVISION}
)

set(EXEC_NAME ${MODULE_NAME}-${SOFT_VERSION})

# OS detection
if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    set(PostgreSQL_LIBRARY -lpq)
    set(PostgreSQL_INCLUDE_DIRS "/opt/homebrew/opt/libpq/include")
    set(PostgreSQL_LIBRARY_DIRS "/opt/homebrew/opt/libpq/lib")
else()
    message(STATUS "PostgreSQL not found via find_package, using manual detection")
    
    if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
        # macOS with Homebrew - try multiple possible locations
        # Apple Silicon Homebrew
        if(EXISTS "/opt/homebrew/opt/libpq/include/libpq-fe.h")
            set(PostgreSQL_INCLUDE_DIRS "/opt/homebrew/opt/libpq/include")
            set(PostgreSQL_LIBRARY_DIRS "/opt/homebrew/opt/libpq/lib")
            set(PostgreSQL_LIBRARY -lpq)
            message(STATUS "Found PostgreSQL at Apple Silicon Homebrew: ${PostgreSQL_INCLUDE_DIRS}")
        # Intel Homebrew
        elseif(EXISTS "/usr/local/opt/libpq/include/libpq-fe.h")
            set(PostgreSQL_INCLUDE_DIRS "/usr/local/opt/libpq/include")
            set(PostgreSQL_LIBRARY_DIRS "/usr/local/opt/libpq/lib")
            set(PostgreSQL_LIBRARY -lpq)
            message(STATUS "Found PostgreSQL at Intel Homebrew: ${PostgreSQL_INCLUDE_DIRS}")
        # MacPorts
        elseif(EXISTS "/opt/local/include/postgresql/libpq-fe.h")
            set(PostgreSQL_INCLUDE_DIRS "/opt/local/include/postgresql")
            set(PostgreSQL_LIBRARY_DIRS "/opt/local/lib")
            set(PostgreSQL_LIBRARY -lpq)
            message(STATUS "Found PostgreSQL at MacPorts: ${PostgreSQL_INCLUDE_DIRS}")
        else()
            # Try to use brew --prefix to find libpq
            find_program(BREW_EXECUTABLE brew)
            if(BREW_EXECUTABLE)
                execute_process(
                    COMMAND ${BREW_EXECUTABLE} --prefix libpq
                    OUTPUT_VARIABLE BREW_LIBPQ_PREFIX
                    OUTPUT_STRIP_TRAILING_WHITESPACE
                )
                if(EXISTS "${BREW_LIBPQ_PREFIX}/include/libpq-fe.h")
                    set(PostgreSQL_INCLUDE_DIRS "${BREW_LIBPQ_PREFIX}/include")
                    set(PostgreSQL_LIBRARY_DIRS "${BREW_LIBPQ_PREFIX}/lib")
                    set(PostgreSQL_LIBRARY -lpq)
                    message(STATUS "Found PostgreSQL via brew --prefix: ${PostgreSQL_INCLUDE_DIRS}")
                else()
                    message(FATAL_ERROR "PostgreSQL (libpq) not found on macOS. Install with: brew install libpq")
                endif()
            else()
                message(FATAL_ERROR "PostgreSQL (libpq) not found on macOS. Install with: brew install libpq")
            endif()
        endif()
    else()
        # Linux - standard paths
        if(EXISTS "/usr/include/postgresql/libpq-fe.h")
            set(PostgreSQL_INCLUDE_DIRS "/usr/include/postgresql")
            set(PostgreSQL_LIBRARY_DIRS "/usr/lib/x86_64-linux-gnu")
            set(PostgreSQL_LIBRARY /usr/lib/x86_64-linux-gnu/libpq.so)
            message(STATUS "Found PostgreSQL at standard Linux path: ${PostgreSQL_INCLUDE_DIRS}")
        elseif(EXISTS "/usr/include/libpq-fe.h")
            set(PostgreSQL_INCLUDE_DIRS "/usr/include")
            set(PostgreSQL_LIBRARY_DIRS "/usr/lib/x86_64-linux-gnu")
            set(PostgreSQL_LIBRARY /usr/lib/x86_64-linux-gnu/libpq.so)
            message(STATUS "Found PostgreSQL at /usr/include: ${PostgreSQL_INCLUDE_DIRS}")
        else()
            message(FATAL_ERROR "PostgreSQL (libpq) not found on Linux. Install with: sudo apt-get install libpq-dev (Debian/Ubuntu) or sudo yum install postgresql-devel (RHEL/CentOS)")
        endif()
    endif()
endif()

link_directories(${PostgreSQL_LIBRARY_DIRS})

find_package(OpenSSL REQUIRED)

# Find jansson via pkg-config
find_package(PkgConfig REQUIRED)
pkg_check_modules(JANSSON REQUIRED jansson)

# feature checks
include(CheckLibraryExists)
check_library_exists(rt clock_gettime "time.h" CONFIG_SYSTEM_HAS_CLOCK_GETTIME)

if(CONFIG_SYSTEM_HAS_CLOCK_GETTIME)
    set(EXTRA_LIBS -lrt)
else()
    set(EXTRA_LIBS "")
endif()

# check if we are on a little or a big endian
include(TestBigEndian)
test_big_endian(PLATFORM_IS_BIGENDIAN)

add_subdirectory(common)

include_directories(
        .
        ${PostgreSQL_INCLUDE_DIRS}
        ${OPENSSL_INCLUDE_DIR}
        ${JANSSON_INCLUDE_DIRS}
        ${CMAKE_CURRENT_LIST_DIR}/common/inc
        ${CMAKE_CURRENT_LIST_DIR}/proxy/inc
        ${CMAKE_CURRENT_LIST_DIR}/resources/inc
        ${CMAKE_CURRENT_LIST_DIR}/db/inc
        ${PROJECT_BINARY_DIR}
)

link_directories(${JANSSON_LIBRARY_DIRS})

add_executable(${EXEC_NAME}
        main.c
        proxy/server/proxy_server.c
        resources/signal_handler.c
        resources/time_counter.c
        db/db_func.c
        proxy/server/device_manager.c
        proxy/server/monitoring_statistics.c
        proxy/server/security_features.c
        proxy/server/proxy_server_device_integration.c
)

target_link_libraries(${EXEC_NAME}
        server_proxy_common
        ${EXTRA_LIBS}
        ${OPENSSL_LIBRARIES}
        ${JANSSON_LIBRARIES}
)
