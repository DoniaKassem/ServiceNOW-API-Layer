#!/bin/bash

# ServiceNow AI Orchestration - Docker Quick Start Script
# This script helps developers quickly get started with the containerized application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

print_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
}

print_error() {
    echo -e "${RED}✗ ${1}${NC}"
}

print_header() {
    echo ""
    echo "=================================="
    echo "$1"
    echo "=================================="
    echo ""
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        echo "Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi
    print_success "Docker is installed"
}

# Check if Docker Compose is installed
check_docker_compose() {
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        echo "Visit: https://docs.docker.com/compose/install/"
        exit 1
    fi
    print_success "Docker Compose is installed"
}

# Check if Docker daemon is running
check_docker_daemon() {
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    print_success "Docker daemon is running"
}

# Setup environment file
setup_env() {
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from template..."
        if [ -f .env.docker ]; then
            cp .env.docker .env
            print_success "Created .env file from .env.docker"
            print_warning "Please edit .env file with your ServiceNow instance URL"
            
            # Prompt for ServiceNow instance
            read -p "Enter your ServiceNow instance URL (or press Enter to use default): " instance_url
            if [ ! -z "$instance_url" ]; then
                sed -i.bak "s|VITE_SERVICENOW_INSTANCE=.*|VITE_SERVICENOW_INSTANCE=$instance_url|" .env
                rm .env.bak 2>/dev/null || true
                print_success "Updated ServiceNow instance URL"
            fi
        else
            print_error ".env.docker template not found"
            exit 1
        fi
    else
        print_success ".env file already exists"
    fi
}

# Start development environment
start_dev() {
    print_header "Starting Development Environment"
    
    print_info "Building Docker images..."
    docker-compose build
    
    print_info "Starting containers..."
    docker-compose up -d
    
    print_success "Development environment started!"
    echo ""
    echo "Application is running at: http://localhost:5173"
    echo ""
    echo "Useful commands:"
    echo "  View logs:        docker-compose logs -f"
    echo "  Stop containers:  docker-compose down"
    echo "  Restart:          docker-compose restart"
    echo "  Shell access:     docker-compose exec app-dev sh"
    echo ""
}

# Start production environment
start_prod() {
    print_header "Starting Production Environment"
    
    print_info "Building Docker images..."
    docker-compose -f docker-compose.prod.yml build
    
    print_info "Starting containers..."
    docker-compose -f docker-compose.prod.yml up -d
    
    print_success "Production environment started!"
    echo ""
    echo "Application is running at: http://localhost:8080"
    echo ""
    echo "Health check: http://localhost:8080/health"
    echo ""
    echo "Useful commands:"
    echo "  View logs:        docker-compose -f docker-compose.prod.yml logs -f"
    echo "  Stop containers:  docker-compose -f docker-compose.prod.yml down"
    echo "  Health status:    curl http://localhost:8080/health"
    echo ""
}

# Stop all containers
stop_all() {
    print_header "Stopping All Containers"
    
    if docker-compose ps -q &> /dev/null; then
        docker-compose down
        print_success "Development containers stopped"
    fi
    
    if docker-compose -f docker-compose.prod.yml ps -q &> /dev/null; then
        docker-compose -f docker-compose.prod.yml down
        print_success "Production containers stopped"
    fi
}

# Clean up Docker resources
cleanup() {
    print_header "Cleaning Up Docker Resources"
    
    print_warning "This will remove containers, volumes, and images. Continue? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        stop_all
        docker-compose down -v --rmi local
        docker-compose -f docker-compose.prod.yml down -v --rmi local
        print_success "Cleanup completed"
    else
        print_info "Cleanup cancelled"
    fi
}

# View logs
view_logs() {
    if [ "$1" == "prod" ]; then
        docker-compose -f docker-compose.prod.yml logs -f
    else
        docker-compose logs -f
    fi
}

# Show status
show_status() {
    print_header "Container Status"
    
    echo "Development:"
    docker-compose ps
    
    echo ""
    echo "Production:"
    docker-compose -f docker-compose.prod.yml ps
}

# Show help
show_help() {
    echo "ServiceNow AI Orchestration - Docker Management Script"
    echo ""
    echo "Usage: ./docker-start.sh [command]"
    echo ""
    echo "Commands:"
    echo "  dev           Start development environment (default)"
    echo "  prod          Start production environment"
    echo "  stop          Stop all containers"
    echo "  restart-dev   Restart development environment"
    echo "  restart-prod  Restart production environment"
    echo "  logs          View development logs"
    echo "  logs-prod     View production logs"
    echo "  status        Show container status"
    echo "  cleanup       Remove all containers, volumes, and images"
    echo "  help          Show this help message"
    echo ""
}

# Main script
main() {
    print_header "ServiceNow AI Orchestration - Docker Setup"
    
    # Check prerequisites
    check_docker
    check_docker_compose
    check_docker_daemon
    
    # Setup environment
    setup_env
    
    # Parse command
    case "${1:-dev}" in
        dev)
            start_dev
            ;;
        prod)
            start_prod
            ;;
        stop)
            stop_all
            ;;
        restart-dev)
            stop_all
            start_dev
            ;;
        restart-prod)
            stop_all
            start_prod
            ;;
        logs)
            view_logs dev
            ;;
        logs-prod)
            view_logs prod
            ;;
        status)
            show_status
            ;;
        cleanup)
            cleanup
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"