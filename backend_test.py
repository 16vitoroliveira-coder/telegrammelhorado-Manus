#!/usr/bin/env python3
"""
Backend API Testing for Telegram Manager Application
Tests the key authentication and protected endpoints
"""

import requests
import json
import sys
import os
from datetime import datetime

# Get backend URL from frontend .env file
def get_backend_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except:
        pass
    return "http://localhost:8001"

BASE_URL = get_backend_url()
API_URL = f"{BASE_URL}/api"

# Test data
TEST_EMAIL = "testuser@example.com"
TEST_PASSWORD = "testpass123"
TEST_NAME = "Test User"

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.results = []
    
    def add_result(self, test_name, success, message="", response_data=None):
        if success:
            self.passed += 1
            status = "✅ PASS"
        else:
            self.failed += 1
            status = "❌ FAIL"
        
        result = f"{status} - {test_name}"
        if message:
            result += f": {message}"
        
        self.results.append(result)
        print(result)
        
        if response_data and not success:
            print(f"   Response: {response_data}")
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"TEST SUMMARY")
        print(f"{'='*60}")
        print(f"Total Tests: {total}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Success Rate: {(self.passed/total*100):.1f}%" if total > 0 else "No tests run")
        print(f"{'='*60}")
        
        if self.failed > 0:
            print("\nFAILED TESTS:")
            for result in self.results:
                if "❌ FAIL" in result:
                    print(f"  {result}")

def test_api():
    results = TestResults()
    token = None
    
    print(f"Testing Telegram Manager Backend API")
    print(f"Backend URL: {BASE_URL}")
    print(f"API URL: {API_URL}")
    print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)
    
    # Test 1: Root endpoint
    try:
        response = requests.get(f"{API_URL}/", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if "message" in data:
                results.add_result("GET /api/ - Root endpoint", True, f"Status: {response.status_code}, Message: {data['message']}")
            else:
                results.add_result("GET /api/ - Root endpoint", False, f"Missing message field", data)
        else:
            results.add_result("GET /api/ - Root endpoint", False, f"Status: {response.status_code}", response.text)
    except Exception as e:
        results.add_result("GET /api/ - Root endpoint", False, f"Connection error: {str(e)}")
    
    # Test 2: User Registration
    try:
        # First, try to clean up any existing test user (ignore errors)
        try:
            login_response = requests.post(f"{API_URL}/auth/login", 
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=10)
            if login_response.status_code == 200:
                # User exists, we'll use it for login test
                pass
        except:
            pass
        
        register_data = {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD,
            "name": TEST_NAME
        }
        
        response = requests.post(f"{API_URL}/auth/register", json=register_data, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "token" in data and "user" in data:
                token = data["token"]
                results.add_result("POST /api/auth/register - User registration", True, 
                                 f"Status: {response.status_code}, Token received, User ID: {data['user'].get('id', 'N/A')}")
            else:
                results.add_result("POST /api/auth/register - User registration", False, 
                                 "Missing token or user in response", data)
        elif response.status_code == 400:
            # User might already exist, try login instead
            data = response.json()
            if "já cadastrado" in data.get("detail", "").lower() or "already" in data.get("detail", "").lower():
                results.add_result("POST /api/auth/register - User registration", True, 
                                 f"User already exists (expected): {data.get('detail', '')}")
            else:
                results.add_result("POST /api/auth/register - User registration", False, 
                                 f"Status: {response.status_code}, Detail: {data.get('detail', '')}", data)
        else:
            results.add_result("POST /api/auth/register - User registration", False, 
                             f"Status: {response.status_code}", response.text)
    except Exception as e:
        results.add_result("POST /api/auth/register - User registration", False, f"Connection error: {str(e)}")
    
    # Test 3: User Login
    try:
        login_data = {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        }
        
        response = requests.post(f"{API_URL}/auth/login", json=login_data, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "token" in data and "user" in data:
                token = data["token"]  # Use login token
                results.add_result("POST /api/auth/login - User login", True, 
                                 f"Status: {response.status_code}, Token received, User: {data['user'].get('email', 'N/A')}")
            else:
                results.add_result("POST /api/auth/login - User login", False, 
                                 "Missing token or user in response", data)
        else:
            results.add_result("POST /api/auth/login - User login", False, 
                             f"Status: {response.status_code}", response.text)
    except Exception as e:
        results.add_result("POST /api/auth/login - User login", False, f"Connection error: {str(e)}")
    
    # Test 4: Protected route without token
    try:
        response = requests.get(f"{API_URL}/auth/me", timeout=10)
        
        if response.status_code in [401, 403]:
            results.add_result("GET /api/auth/me - Protected route (no token)", True, 
                             f"Correctly rejected with status: {response.status_code}")
        else:
            results.add_result("GET /api/auth/me - Protected route (no token)", False, 
                             f"Should reject without token, got status: {response.status_code}", response.text)
    except Exception as e:
        results.add_result("GET /api/auth/me - Protected route (no token)", False, f"Connection error: {str(e)}")
    
    # Test 5: Protected route with invalid token
    try:
        headers = {"Authorization": "Bearer invalid_token_here"}
        response = requests.get(f"{API_URL}/auth/me", headers=headers, timeout=10)
        
        if response.status_code in [401, 403]:
            results.add_result("GET /api/auth/me - Protected route (invalid token)", True, 
                             f"Correctly rejected invalid token with status: {response.status_code}")
        else:
            results.add_result("GET /api/auth/me - Protected route (invalid token)", False, 
                             f"Should reject invalid token, got status: {response.status_code}", response.text)
    except Exception as e:
        results.add_result("GET /api/auth/me - Protected route (invalid token)", False, f"Connection error: {str(e)}")
    
    # Test 6: Protected route with valid token
    if token:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            response = requests.get(f"{API_URL}/auth/me", headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if "id" in data and "email" in data:
                    results.add_result("GET /api/auth/me - Protected route (valid token)", True, 
                                     f"Status: {response.status_code}, User: {data.get('email', 'N/A')}")
                else:
                    results.add_result("GET /api/auth/me - Protected route (valid token)", False, 
                                     "Missing user data in response", data)
            else:
                results.add_result("GET /api/auth/me - Protected route (valid token)", False, 
                                 f"Status: {response.status_code}", response.text)
        except Exception as e:
            results.add_result("GET /api/auth/me - Protected route (valid token)", False, f"Connection error: {str(e)}")
    else:
        results.add_result("GET /api/auth/me - Protected route (valid token)", False, "No token available from login/register")
    
    # Test 7: Plans endpoint
    try:
        response = requests.get(f"{API_URL}/plans", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "plans" in data and isinstance(data["plans"], list) and len(data["plans"]) > 0:
                plan_names = [plan.get("name", "Unknown") for plan in data["plans"]]
                results.add_result("GET /api/plans - Available plans", True, 
                                 f"Status: {response.status_code}, Plans: {', '.join(plan_names)}")
            else:
                results.add_result("GET /api/plans - Available plans", False, 
                                 "Missing or empty plans array", data)
        else:
            results.add_result("GET /api/plans - Available plans", False, 
                             f"Status: {response.status_code}", response.text)
    except Exception as e:
        results.add_result("GET /api/plans - Available plans", False, f"Connection error: {str(e)}")
    
    # Test 8: Templates endpoint (protected)
    if token:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            response = requests.get(f"{API_URL}/templates", headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    results.add_result("GET /api/templates - Message templates (protected)", True, 
                                     f"Status: {response.status_code}, Templates count: {len(data)}")
                else:
                    results.add_result("GET /api/templates - Message templates (protected)", False, 
                                     "Response is not a list", data)
            else:
                results.add_result("GET /api/templates - Message templates (protected)", False, 
                                 f"Status: {response.status_code}", response.text)
        except Exception as e:
            results.add_result("GET /api/templates - Message templates (protected)", False, f"Connection error: {str(e)}")
    
    # Test 9: Groups endpoint (protected)
    if token:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            response = requests.get(f"{API_URL}/groups", headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    results.add_result("GET /api/groups - User groups (protected)", True, 
                                     f"Status: {response.status_code}, Groups count: {len(data)}")
                else:
                    results.add_result("GET /api/groups - User groups (protected)", False, 
                                     "Response is not a list", data)
            else:
                results.add_result("GET /api/groups - User groups (protected)", False, 
                                 f"Status: {response.status_code}", response.text)
        except Exception as e:
            results.add_result("GET /api/groups - User groups (protected)", False, f"Connection error: {str(e)}")
    
    # Test 10: Broadcast endpoint (protected) - should fail without groups
    if token:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            broadcast_data = {
                "message": "Test broadcast message",
                "group_ids": None,
                "account_ids": None
            }
            response = requests.post(f"{API_URL}/broadcast/groups", json=broadcast_data, headers=headers, timeout=10)
            
            if response.status_code == 400:
                data = response.json()
                if "grupo" in data.get("detail", "").lower() or "group" in data.get("detail", "").lower():
                    results.add_result("POST /api/broadcast/groups - Broadcast (protected)", True, 
                                     f"Correctly rejected without groups: {data.get('detail', '')}")
                else:
                    results.add_result("POST /api/broadcast/groups - Broadcast (protected)", False, 
                                     f"Unexpected error message: {data.get('detail', '')}", data)
            elif response.status_code == 403:
                data = response.json()
                if "plano" in data.get("detail", "").lower() or "plan" in data.get("detail", "").lower():
                    results.add_result("POST /api/broadcast/groups - Broadcast (protected)", True, 
                                     f"Correctly rejected due to plan limits: {data.get('detail', '')}")
                else:
                    results.add_result("POST /api/broadcast/groups - Broadcast (protected)", False, 
                                     f"Unexpected 403 error: {data.get('detail', '')}", data)
            else:
                results.add_result("POST /api/broadcast/groups - Broadcast (protected)", False, 
                                 f"Unexpected status: {response.status_code}", response.text)
        except Exception as e:
            results.add_result("POST /api/broadcast/groups - Broadcast (protected)", False, f"Connection error: {str(e)}")
    
    return results

if __name__ == "__main__":
    results = test_api()
    results.summary()
    
    # Exit with error code if any tests failed
    if results.failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)