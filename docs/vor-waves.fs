vec2 psuedoRand(vec2 p) {
	vec3 a = fract(p.xyy * vec3(123.34, 234.45, 345.56));
    a += dot(a, a + 67.78);
    return fract(vec2(a.x * a.y, a.y * a.z));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from -1 to 1)
    vec2 uv = (2.0 * fragCoord - iResolution.xy)/iResolution.xy;
    float circlePoints = 0.0;
    float minDist = 100.0;
    
    for(float i = 1.0; i < 300.0; ++i){
    	vec2 randNum = psuedoRand(vec2(i));
        vec2 position = sin(randNum * (iTime + 10.0) * 0.5);
        float dist = length(uv - position);
        circlePoints += 1.0 - smoothstep(0.09, 0.25, dist);
    }
    
	fragColor = vec4(1.0 / vec3(circlePoints, circlePoints, 1.0), 1.0);
}
