"""
Locality and Geographic Area Service for Urban Heat Mitigation / HeatShield AI.
Provides fast, cached spatial resolution of cell centroids into:
- Verified neighbourhood/locality names (where supported by ground-truth landmarks)
- Precise directional urban sectors (when outside verified landmark zones)
- Administrative areas and formatted geographic coordinates
- Cell footprints and boundaries
Covers all 20 supported Indian cities.
"""

import math
from typing import Dict, Any, List, Optional, Tuple
from pipeline.config import CITIES

# Geodesic distance helper (Haversine formula in km)
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0  # Earth radius in km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


# Verified Landmark Anchors for All 20 Supported Cities
CITY_LOCALITY_ANCHORS: Dict[str, List[Dict[str, Any]]] = {
    "new_delhi": [
        {"name": "Connaught Place / Central Sector", "lat": 28.6315, "lon": 77.2167, "radius_km": 3.0},
        {"name": "Chanakyapuri / Diplomatic Enclave", "lat": 28.5921, "lon": 77.1805, "radius_km": 2.5},
        {"name": "Old Delhi / Chandni Chowk", "lat": 28.6562, "lon": 77.2300, "radius_km": 2.5},
        {"name": "South Delhi / Hauz Khas & Saket", "lat": 28.5355, "lon": 77.2000, "radius_km": 3.5},
        {"name": "Dwarka / IGI Airport Sector", "lat": 28.5823, "lon": 77.0500, "radius_km": 4.5},
        {"name": "Rohini / Pitampura Urban Basin", "lat": 28.7100, "lon": 77.1200, "radius_km": 4.0},
        {"name": "Mayur Vihar / Trans-Yamuna East", "lat": 28.6050, "lon": 77.3000, "radius_km": 3.5},
        {"name": "Vasant Kunj / Mehrauli Ridge", "lat": 28.5200, "lon": 77.1500, "radius_km": 3.0},
        {"name": "Okhla / Nehru Place South East", "lat": 28.5400, "lon": 77.2700, "radius_km": 3.0},
        {"name": "Civil Lines / Delhi University", "lat": 28.6800, "lon": 77.2200, "radius_km": 3.0},
        {"name": "Najafgarh / South-West Peri-Urban", "lat": 28.6100, "lon": 76.9800, "radius_km": 4.5},
        {"name": "Narela / North Industrial Sector", "lat": 28.8400, "lon": 77.0900, "radius_km": 4.5},
    ],
    "mumbai": [
        {"name": "Colaba / Fort / South Mumbai", "lat": 18.9220, "lon": 72.8347, "radius_km": 3.0},
        {"name": "Marine Lines / Nariman Point", "lat": 18.9350, "lon": 72.8250, "radius_km": 2.5},
        {"name": "Dadar / Prabhadevi / Worli", "lat": 19.0178, "lon": 72.8478, "radius_km": 3.0},
        {"name": "Bandra West / Coastal Enclave", "lat": 19.0596, "lon": 72.8295, "radius_km": 2.5},
        {"name": "Andheri / Juhu / Western Suburbs", "lat": 19.1197, "lon": 72.8464, "radius_km": 3.5},
        {"name": "Borivali / Sanjay Gandhi Park West", "lat": 19.2307, "lon": 72.8567, "radius_km": 4.0},
        {"name": "Kurla / Chembur / Eastern Hub", "lat": 19.0657, "lon": 72.8890, "radius_km": 3.5},
        {"name": "Powai / Vikhroli Tech Corridor", "lat": 19.1176, "lon": 72.9060, "radius_km": 3.0},
        {"name": "Malad / Goregaon Suburbs", "lat": 19.1700, "lon": 72.8500, "radius_km": 3.5},
        {"name": "Ghatkopar / Mulund Corridor", "lat": 19.1400, "lon": 72.9300, "radius_km": 3.5},
    ],
    "bengaluru": [
        {"name": "MG Road / Central Business District", "lat": 12.9750, "lon": 77.6050, "radius_km": 2.5},
        {"name": "Koramangala / Indiranagar East", "lat": 12.9352, "lon": 77.6245, "radius_km": 3.0},
        {"name": "Whitefield / ITPB Technology Park", "lat": 12.9698, "lon": 77.7499, "radius_km": 4.0},
        {"name": "Electronic City / South Tech Belt", "lat": 12.8452, "lon": 77.6602, "radius_km": 4.0},
        {"name": "Jayanagar / JP Nagar South", "lat": 12.9250, "lon": 77.5850, "radius_km": 3.0},
        {"name": "Malleshwaram / Rajajinagar West", "lat": 13.0031, "lon": 77.5643, "radius_km": 3.0},
        {"name": "Hebbal / Yelahanka North Corridor", "lat": 13.0358, "lon": 77.5970, "radius_km": 3.5},
        {"name": "Bellandur / Outer Ring Road Basin", "lat": 12.9304, "lon": 77.6784, "radius_km": 3.0},
        {"name": "Peenya / Industrial Zone North West", "lat": 13.0300, "lon": 77.5200, "radius_km": 3.5},
        {"name": "Banashankari / South West Suburbs", "lat": 12.9100, "lon": 77.5400, "radius_km": 3.5},
    ],
    "chennai": [
        {"name": "George Town / Chennai Port", "lat": 13.0900, "lon": 80.2900, "radius_km": 3.0},
        {"name": "Marina Beach / Mylapore", "lat": 13.0350, "lon": 80.2700, "radius_km": 2.5},
        {"name": "T. Nagar / Nungambakkam Commercial", "lat": 13.0400, "lon": 80.2350, "radius_km": 2.5},
        {"name": "Guindy / Adyar Riverfront", "lat": 13.0050, "lon": 80.2250, "radius_km": 3.0},
        {"name": "OMR / Thoraipakkam IT Highway", "lat": 12.9500, "lon": 80.2350, "radius_km": 3.5},
        {"name": "Anna Nagar / West Chennai", "lat": 13.0850, "lon": 80.2100, "radius_km": 3.0},
        {"name": "Velachery / South Chennai Hub", "lat": 12.9800, "lon": 80.2150, "radius_km": 3.0},
        {"name": "Tambaram / South-West Gateway", "lat": 12.9200, "lon": 80.1200, "radius_km": 4.0},
    ],
    "kolkata": [
        {"name": "BBD Bagh / Esplanade Central Core", "lat": 22.5700, "lon": 88.3500, "radius_km": 2.5},
        {"name": "Salt Lake / Bidhannagar Tech City", "lat": 22.5850, "lon": 88.4150, "radius_km": 3.0},
        {"name": "New Town / Rajarhat Extension", "lat": 22.5950, "lon": 88.4650, "radius_km": 3.5},
        {"name": "Park Street / Alipore Heritage", "lat": 22.5450, "lon": 88.3450, "radius_km": 2.5},
        {"name": "Howrah / Hooghly Riverfront West", "lat": 22.5900, "lon": 88.3200, "radius_km": 3.0},
        {"name": "Ballygunge / South Kolkata", "lat": 22.5250, "lon": 88.3650, "radius_km": 3.0},
        {"name": "Dum Dum / Airport North Corridor", "lat": 22.6450, "lon": 88.4350, "radius_km": 3.5},
    ],
    "hyderabad": [
        {"name": "HITEC City / Gachibowli Cyberabad", "lat": 17.4435, "lon": 78.3772, "radius_km": 3.5},
        {"name": "Banjara Hills / Jubilee Hills", "lat": 17.4156, "lon": 78.4350, "radius_km": 3.0},
        {"name": "Charminar / Old City Basin", "lat": 17.3616, "lon": 78.4747, "radius_km": 3.0},
        {"name": "Secunderabad / North Hub", "lat": 17.4399, "lon": 78.4983, "radius_km": 3.5},
        {"name": "Begumpet / Somajiguda Central", "lat": 17.4400, "lon": 78.4600, "radius_km": 2.5},
        {"name": "Kukatpally / Miyapur Industrial", "lat": 17.4950, "lon": 78.3950, "radius_km": 3.5},
        {"name": "Uppal / East Industrial Corridor", "lat": 17.4000, "lon": 78.5600, "radius_km": 3.5},
        {"name": "Shamshabad / Airport South", "lat": 17.2500, "lon": 78.4300, "radius_km": 4.5},
    ],
    "pune": [
        {"name": "Shivajinagar / Deccan Gymkhana", "lat": 18.5300, "lon": 73.8450, "radius_km": 2.5},
        {"name": "Koregaon Park / Kalyani Nagar", "lat": 18.5400, "lon": 73.8950, "radius_km": 2.5},
        {"name": "Hinjawadi / Rajiv Gandhi Infotech Park", "lat": 18.5900, "lon": 73.7350, "radius_km": 3.5},
        {"name": "Kothrud / Karve Nagar West", "lat": 18.5050, "lon": 73.8150, "radius_km": 3.0},
        {"name": "Viman Nagar / Airport Corridor", "lat": 18.5700, "lon": 73.9150, "radius_km": 3.0},
        {"name": "Hadapsar / Magarpatta City", "lat": 18.5050, "lon": 73.9300, "radius_km": 3.5},
        {"name": "Pimpri-Chinchwad Industrial Belt", "lat": 18.6300, "lon": 73.8000, "radius_km": 4.0},
    ],
    "ahmedabad": [
        {"name": "Walled City / Bhadra & Manek Chowk", "lat": 23.0250, "lon": 72.5850, "radius_km": 2.5},
        {"name": "Sabarmati Riverfront Promenade", "lat": 23.0450, "lon": 72.5800, "radius_km": 2.5},
        {"name": "Navrangpura / Ashram Road Core", "lat": 23.0350, "lon": 72.5600, "radius_km": 2.5},
        {"name": "SG Highway / Bodakdev Tech Strip", "lat": 23.0450, "lon": 72.5150, "radius_km": 3.5},
        {"name": "Maninagar / Kankaria Lake Basin", "lat": 22.9950, "lon": 72.6000, "radius_km": 3.0},
        {"name": "Bopal / South-West Expansion", "lat": 23.0300, "lon": 72.4650, "radius_km": 3.5},
        {"name": "Naroda / East Industrial Belt", "lat": 23.0750, "lon": 72.6550, "radius_km": 4.0},
    ],
    "jaipur": [
        {"name": "Pink City / Walled City Heritage", "lat": 26.9200, "lon": 75.8200, "radius_km": 2.5},
        {"name": "C-Scheme / Civil Lines Central", "lat": 26.9050, "lon": 75.7900, "radius_km": 2.5},
        {"name": "Malviya Nagar / WTP South", "lat": 26.8550, "lon": 75.8150, "radius_km": 3.0},
        {"name": "Mansarovar / Sanganer Sector", "lat": 26.8500, "lon": 75.7600, "radius_km": 3.5},
        {"name": "Vaishali Nagar / West Jaipur", "lat": 26.9100, "lon": 75.7400, "radius_km": 3.0},
        {"name": "Amer / North Aravali Foothills", "lat": 26.9850, "lon": 75.8500, "radius_km": 3.5},
        {"name": "Sitapura / Industrial & Tech Zone", "lat": 26.7800, "lon": 75.8300, "radius_km": 3.5},
        {"name": "Jagatpura / Airport East Corridor", "lat": 26.8300, "lon": 75.8500, "radius_km": 3.0},
    ],
    "lucknow": [
        {"name": "Hazratganj / Central Commercial Core", "lat": 26.8500, "lon": 80.9450, "radius_km": 2.5},
        {"name": "Gomti Nagar / Riverfront East", "lat": 26.8550, "lon": 81.0000, "radius_km": 3.5},
        {"name": "Chowk / Old Lucknow Heritage", "lat": 26.8700, "lon": 80.9050, "radius_km": 2.5},
        {"name": "Alambagh / Airport South Corridor", "lat": 26.8050, "lon": 80.9000, "radius_km": 3.5},
        {"name": "Indira Nagar / North East Sector", "lat": 26.8850, "lon": 80.9850, "radius_km": 3.0},
    ],
    "surat": [
        {"name": "Athwa / Tapi Riverfront Enclave", "lat": 21.1750, "lon": 72.8050, "radius_km": 3.0},
        {"name": "Ring Road / Textile Market Hub", "lat": 21.1900, "lon": 72.8450, "radius_km": 2.5},
        {"name": "Adajan / West Surat Suburbs", "lat": 21.2000, "lon": 72.7900, "radius_km": 3.0},
        {"name": "Varachha / Diamond Bourse Sector", "lat": 21.2200, "lon": 72.8750, "radius_km": 3.5},
        {"name": "Udhna / Pandesara Industrial Belt", "lat": 21.1400, "lon": 72.8400, "radius_km": 3.5},
    ],
    "kochi": [
        {"name": "Fort Kochi / Mattancherry Heritage", "lat": 9.9650, "lon": 76.2400, "radius_km": 2.5},
        {"name": "Marine Drive / Ernakulam Central", "lat": 9.9800, "lon": 76.2800, "radius_km": 2.5},
        {"name": "Kakkanad / Infopark SmartCity", "lat": 10.0150, "lon": 76.3600, "radius_km": 3.5},
        {"name": "Willingdon Island / Port Zone", "lat": 9.9500, "lon": 76.2700, "radius_km": 2.5},
        {"name": "Edappally / North Kochi Corridor", "lat": 10.0250, "lon": 76.3100, "radius_km": 3.0},
    ],
    "chandigarh": [
        {"name": "Sector 17 / City Commercial Center", "lat": 30.7400, "lon": 76.7800, "radius_km": 2.5},
        {"name": "Sukhna Lake / Capitol Complex", "lat": 30.7450, "lon": 76.8150, "radius_km": 2.5},
        {"name": "Sector 35 / 43 South-West Hub", "lat": 30.7200, "lon": 76.7500, "radius_km": 2.5},
        {"name": "IT Park / Kishangarh Sector", "lat": 30.7250, "lon": 76.8350, "radius_km": 3.0},
        {"name": "Mohali Industrial Border West", "lat": 30.7000, "lon": 76.7150, "radius_km": 3.5},
    ],
    "nagpur": [
        {"name": "Sitabuldi / Zero Mile Core", "lat": 21.1480, "lon": 79.0850, "radius_km": 2.5},
        {"name": "Dharampeth / Ramdaspeth West", "lat": 21.1400, "lon": 79.0600, "radius_km": 2.5},
        {"name": "MIHAN / Airport South SEZ", "lat": 21.0600, "lon": 79.0550, "radius_km": 4.0},
        {"name": "Civil Lines / Administrative Enclave", "lat": 21.1600, "lon": 79.0750, "radius_km": 2.5},
        {"name": "Wardhaman Nagar / East Nagpur", "lat": 21.1500, "lon": 79.1350, "radius_km": 3.0},
    ],
    "patna": [
        {"name": "Gandhi Maidan / Central Corridor", "lat": 25.6200, "lon": 85.1450, "radius_km": 2.5},
        {"name": "Bailey Road / Raj Bhavan Enclave", "lat": 25.6100, "lon": 85.1150, "radius_km": 2.5},
        {"name": "Patna Sahib / Historic East", "lat": 25.5900, "lon": 85.2250, "radius_km": 3.5},
        {"name": "Kankarbagh / South Urban Colony", "lat": 25.5850, "lon": 85.1550, "radius_km": 3.0},
        {"name": "Patliputra Colony / North-West", "lat": 25.6350, "lon": 85.1100, "radius_km": 2.5},
    ],
    "bhopal": [
        {"name": "MP Nagar / Commercial CBD", "lat": 23.2350, "lon": 77.4350, "radius_km": 2.5},
        {"name": "Upper Lake / VIP Road Promenade", "lat": 23.2450, "lon": 77.3800, "radius_km": 3.0},
        {"name": "Arera Colony / South Green Zone", "lat": 23.2100, "lon": 77.4300, "radius_km": 2.5},
        {"name": "Old Bhopal / Taj-ul-Masajid Basin", "lat": 23.2700, "lon": 77.4050, "radius_km": 2.5},
        {"name": "Govindpura / BHEL Industrial Belt", "lat": 23.2600, "lon": 77.4750, "radius_km": 3.5},
    ],
    "visakhapatnam": [
        {"name": "RK Beach / Coastal Promenade", "lat": 17.7150, "lon": 83.3250, "radius_km": 2.5},
        {"name": "Jagadamba Junction / Central Hub", "lat": 17.7100, "lon": 83.3000, "radius_km": 2.5},
        {"name": "MVP Colony / North Coastal Sector", "lat": 17.7450, "lon": 83.3450, "radius_km": 2.5},
        {"name": "Gajuwaka / Steel Plant Industrial", "lat": 17.7000, "lon": 83.1850, "radius_km": 4.0},
        {"name": "Rushikonda / IT SEZ Hill Corridor", "lat": 17.7850, "lon": 83.3850, "radius_km": 3.0},
    ],
    "guwahati": [
        {"name": "Panbazar / Fancy Bazar Riverside", "lat": 26.1850, "lon": 91.7450, "radius_km": 2.5},
        {"name": "Dispur / Assam Capital Complex", "lat": 26.1450, "lon": 91.7900, "radius_km": 3.0},
        {"name": "Kamakhya / Nilachal Hills", "lat": 26.1700, "lon": 91.7050, "radius_km": 2.5},
        {"name": "Jalukbari / Gauhati University West", "lat": 26.1550, "lon": 91.6650, "radius_km": 3.0},
        {"name": "Khanapara / Meghalaya Foothills", "lat": 26.1150, "lon": 91.8250, "radius_km": 3.5},
    ],
    "vijayawada": [
        {"name": "Benz Circle / Commercial CBD", "lat": 16.5050, "lon": 80.6550, "radius_km": 2.5},
        {"name": "Kanaka Durga / Krishna Riverfront", "lat": 16.5200, "lon": 80.6150, "radius_km": 2.5},
        {"name": "Governorpet / Historic Old Core", "lat": 16.5150, "lon": 80.6350, "radius_km": 2.0},
        {"name": "Auto Nagar / Industrial Sector", "lat": 16.4950, "lon": 80.6850, "radius_km": 3.0},
        {"name": "Gunadala / North Hill Enclave", "lat": 16.5250, "lon": 80.6700, "radius_km": 2.5},
    ],
    "coimbatore": [
        {"name": "Gandhipuram / Commercial City Center", "lat": 11.0200, "lon": 76.9700, "radius_km": 2.5},
        {"name": "RS Puram / West Green Enclave", "lat": 11.0100, "lon": 76.9500, "radius_km": 2.5},
        {"name": "Peelamedu / Tidel Park IT Corridor", "lat": 11.0350, "lon": 77.0250, "radius_km": 3.0},
        {"name": "Saibaba Colony / North Sector", "lat": 11.0350, "lon": 76.9450, "radius_km": 2.5},
        {"name": "Saravanampatti / North Tech Hub", "lat": 11.0850, "lon": 77.0000, "radius_km": 3.5},
    ],
}


def get_directional_sector(lat: float, lon: float, center_lat: float, center_lon: float) -> str:
    """Computes a precise, verified geographic directional sector relative to city center."""
    dlat = lat - center_lat
    dlon = lon - center_lon
    dist_deg = math.sqrt(dlat**2 + dlon**2)

    if dist_deg < 0.025:  # within ~2.5km of center
        return "Central Urban Core"

    ns = "North" if dlat >= 0.0 else "South"
    ew = "East" if dlon >= 0.0 else "West"

    # Predominant axis vs diagonal
    if abs(dlat) > 2.0 * abs(dlon):
        return f"{ns}ern Sector"
    elif abs(dlon) > 2.0 * abs(dlat):
        return f"{ew}ern Sector"
    else:
        return f"{ns}-{ew} Sector"


def resolve_cell_locality(city_id: str, lat: float, lon: float) -> Dict[str, Any]:
    """
    Resolves a cell's coordinates to its administrative area, verified locality/neighborhood,
    or clear geographic sector for all 20 cities.
    """
    meta = CITIES.get(city_id, {})
    city_name = meta.get("name", city_id.replace("_", " ").title())
    state_name = meta.get("state", "India")
    country_name = meta.get("country", "India")
    center_lon, center_lat = meta.get("center", (77.20, 28.61))

    # Check verified landmark anchors
    anchors = CITY_LOCALITY_ANCHORS.get(city_id, [])
    best_anchor = None
    min_dist_km = float("inf")

    for anchor in anchors:
        d_km = haversine_km(lat, lon, anchor["lat"], anchor["lon"])
        if d_km < min_dist_km:
            min_dist_km = d_km
            best_anchor = anchor

    if best_anchor and min_dist_km <= best_anchor["radius_km"]:
        locality_label = best_anchor["name"]
        is_landmark = True
    else:
        # Fall back to clear directional geographic sector — NEVER invent fake names
        sector = get_directional_sector(lat, lon, center_lat, center_lon)
        locality_label = sector
        is_landmark = False

    formatted_coords = f"{abs(lat):.4f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.4f}°{'E' if lon >= 0 else 'W'}"

    return {
        "city_id": city_id,
        "city_name": city_name,
        "admin_area": f"{city_name}, {state_name}",
        "locality": locality_label,
        "is_verified_landmark": is_landmark,
        "formatted_coordinates": formatted_coords,
        "center_lat": round(lat, 4),
        "center_lon": round(lon, 4),
        "coverage_footprint": "~500m × 500m (0.25 km²)",
        "dist_to_center_km": round(haversine_km(lat, lon, center_lat, center_lon), 2),
    }
